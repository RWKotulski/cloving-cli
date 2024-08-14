import ncp from 'copy-paste'
import path from 'path'
import fs from 'fs'
import readline from 'readline'
import { execFileSync, execSync } from 'child_process'
import type { AxiosError } from 'axios'

import ChunkManager from './ChunkManager'
import ReviewManager from './ReviewManager'
import ClovingGPT from '../cloving_gpt'
import { generateCommitMessagePrompt } from '../utils/git_utils'
import { extractFilesAndContent, saveGeneratedFiles, extractMarkdown } from '../utils/string_utils'
import { getAllFilesInDirectory } from '../utils/command_utils'
import type { ClovingGPTOptions, ChatMessage } from '../utils/types'

const PREAMBLE = `When generating code, don't apologize and wherever possible include filenames in bold with paths to the code files mentioned and do not be lazy and ask me to keep the existing code or show things like previous code remains unchanged, always include existing code in the response.`;

class ChatManager {
  private gpt: ClovingGPT
  private rl: readline.Interface
  private chatHistory: ChatMessage[] = []
  private commandHistory: string[] = []
  private historyIndex: number = -1
  private multilineInput: string = ''
  private isMultilineMode: boolean = false
  private contextFiles: Record<string, string> = {}
  private chunkManager: ChunkManager
  private prompt: string = ''
  private isProcessing: boolean = false

  constructor(private options: ClovingGPTOptions) {
    options.stream = true
    options.silent = true
    this.gpt = new ClovingGPT(options)
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '\x1b[32mcloving> \x1b[0m', // Set the prompt to green
      historySize: 1000,
    })
    this.chunkManager = new ChunkManager()
  }

  async initialize() {
    console.log('\nWelcome to Cloving REPL.\n\n\x1b[31mType "exit" to quit.\x1b[0m\n')
    this.rl.prompt()

    this.setupEventListeners()
    await this.loadContextFiles()
  }

  private setupEventListeners() {
    this.rl.on('line', this.handleLine.bind(this))
    this.rl.on('close', this.handleClose.bind(this))
    process.stdin.on('keypress', this.handleKeypress.bind(this))
  }

  private async loadContextFiles() {
    let files = this.options.files || '.'
    let expandedFiles: string[] = []

    for (const file of files) {
      const filePath = path.resolve(file)
      if (await fs.promises.stat(filePath).then(stat => stat.isDirectory()).catch(() => false)) {
        const dirFiles = await getAllFilesInDirectory(filePath)
        expandedFiles = expandedFiles.concat(dirFiles.map(f => path.relative(process.cwd(), f)))
      } else {
        expandedFiles.push(path.relative(process.cwd(), filePath))
      }
    }
    files = expandedFiles

    for (const file of files) {
      const filePath = path.resolve(file)
      if (await fs.promises.stat(filePath).then(stat => stat.isFile()).catch(() => false)) {
        const content = await fs.promises.readFile(filePath, 'utf-8')
        this.contextFiles[file] = content
      }
    }
  }

  private async handleLine(line: string) {
    if (this.isProcessing) {
      return
    }

    if (this.isMultilineMode) {
      if (line.trim() === '```') {
        this.isMultilineMode = false
        line = this.multilineInput
        this.multilineInput = ''
      } else {
        this.multilineInput += line + '\n'
        this.rl.prompt()
        return
      }
    } else if (line.trim() === '```') {
      this.isMultilineMode = true
      this.multilineInput = ''
      console.log('Entering multiline mode. Type ``` on a new line to end.\n')
      this.rl.prompt()
      return
    }

    const trimmedLine = line.trim()

    if (trimmedLine === '') {
      this.rl.prompt()
      return
    }

    this.updateCommandHistory(trimmedLine)

    if (trimmedLine.toLowerCase() === 'exit') {
      this.rl.close()
      return
    }

    await this.handleCommand(trimmedLine)
  }

  private updateCommandHistory(command: string) {
    if (this.commandHistory[0] !== command) {
      this.commandHistory.unshift(command)
      if (this.commandHistory.length > 1000) {
        this.commandHistory.pop()
      }
    }
    this.historyIndex = -1
  }

  private async handleCommand(command: string) {
    switch (command) {
      case 'copy':
        await this.handleCopy()
        break
      case 'save':
        await this.handleSave()
        break
      case 'commit':
        await this.handleCommit()
        break
      case 'review':
        await this.handleReview()
        break
      default:
        if (this.isGitCommand(command)) {
          this.executeGitCommand(command)
        } else {
          await this.processUserInput(command)
        }
    }
  }

  private async handleCopy() {
    const lastResponse = this.chatHistory.filter(msg => msg.role === 'assistant').pop()
    if (lastResponse) {
      ncp.copy(lastResponse.content, () => {
        console.info('Last response copied to clipboard.')
      })
    } else {
      console.error('\n\x1b[31mNo response to copy.\x1b[0m')
    }
  }

  private async handleReview() {
    this.gpt.stream = false
    const reviewManager = new ReviewManager(this.gpt, this.options)
    await reviewManager.review()
    this.gpt.stream = true
  }

  private async handleSave() {
    const lastResponse = this.chatHistory.filter(msg => msg.role === 'assistant').pop()
    if (lastResponse) {
      const fileContents = extractFilesAndContent(lastResponse.content)
      if (Object.keys(fileContents).length > 0) {
        await saveGeneratedFiles(fileContents)
        console.info('Files have been saved.')
        this.rl.prompt()
      } else {
        console.info('No files found to save in the last response.')
        this.rl.prompt()
      }
    } else {
      console.error('\n\x1b[31mNo response to save files from.\x1b[0m')
      this.rl.prompt()
    }
  }

  private async handleCommit() {
    const diff = execSync('git diff HEAD').toString().trim()

    if (!diff) {
      console.error('\n\x1b[31mNo changes to commit.\x1b[0m')
      this.rl.prompt()
      return
    }

    this.prompt = generateCommitMessagePrompt(diff)
    this.gpt.stream = false
    const rawCommitMessage = await this.gpt.generateText({ prompt: this.prompt })
    this.gpt.stream = true

    const commitMessage = extractMarkdown(rawCommitMessage)
    const tempCommitFilePath = path.join('.git', 'SUGGESTED_COMMIT_EDITMSG')
    fs.writeFileSync(tempCommitFilePath, commitMessage)

    try {
      execFileSync('git', ['commit', '-a', '--edit', '--file', tempCommitFilePath], { stdio: 'inherit' })
    } catch (commitError) {
      console.error('\n\x1b[31mCommit was canceled or failed.\x1b[0m')
    }

    fs.unlink(tempCommitFilePath, (err) => {
      if (err) throw err
    })
    this.rl.prompt()
  }

  private isGitCommand(command: string): boolean {
    return command.split(' ').length <= 3 && command.startsWith('git ')
  }

  private executeGitCommand(command: string) {
    try {
      execSync(command, { stdio: 'inherit' })
    } catch (error) {
      console.error('\n\x1b[31mError running command:\x1b[0m', error)
    }
    this.rl.prompt()
  }

  private async processUserInput(input: string) {
    if (this.isProcessing) {
      console.log('Please wait for the current request to complete.')
      return
    }

    this.isProcessing = true
    this.chunkManager = new ChunkManager()

    try {
      this.chatHistory.push({ role: 'user', content: input })

      this.prompt = this.generatePrompt(input)
      const responseStream = await this.gpt.streamText({ prompt: this.prompt })

      let accumulatedContent = ''

      this.chunkManager.on('content', (buffer: string) => {
        let convertedStream = this.gpt.convertStream(buffer)

        while (convertedStream !== null) {
          const { output, lastChar } = convertedStream
          process.stdout.write(output)
          accumulatedContent += output
          this.chunkManager.clearBuffer(lastChar)
          buffer = buffer.slice(lastChar)
          convertedStream = this.gpt.convertStream(buffer)
        }
      })

      responseStream.data.on('data', (chunk: Buffer) => {
        const chunkString = chunk.toString()
        this.chunkManager.addChunk(chunkString)
      })

      responseStream.data.on('end', () => {
        this.chatHistory.push({ role: 'assistant', content: accumulatedContent.trim() })
        this.isProcessing = false
        process.stdout.write('\n')
        this.rl.prompt()
      })

      responseStream.data.on('error', (error: Error) => {
        console.error('\n\x1b[31mError streaming response:\x1b[0m', error)
        this.isProcessing = false
        process.stdout.write('\n')
        this.rl.prompt()
      })
    } catch (err) {
      const error = err as AxiosError
      let errorMessage = error.message || 'An error occurred.'
      const errorNumber = error.response?.status || 'unknown'
      // switch case
      switch (errorNumber) {
        case 400:
          errorMessage = "Invalid model or prompt size too large. Try specifying fewer files."
          break;
        case 403:
          errorMessage = "Inactive subscription or usage limit reached"
          break;
        case 429:
          errorMessage = "Rate limit error"
          break;
        case 500:
          errorMessage = "Internal server error"
          break;
      }

      // get token estimate for prompt
      const promptTokens = Math.ceil(this.prompt.length / 4).toLocaleString()

      console.error(`\n\x1b[31mError processing a ${promptTokens} token prompt:\x1b[0m`, errorMessage, `(${errorNumber})\n`)
      this.isProcessing = false
      this.rl.prompt()
    }
  }

  private generatePrompt(input: string): string {
    const contextFileContents = Object.keys(this.contextFiles)
      .map((file) => `### Contents of ${file}\n\n${this.contextFiles[file]}\n\n`)
      .join('\n')

    const allButLast = this.chatHistory.slice(0, -1).map(msg => `${msg.role.toUpperCase()}: ${msg.content}`).join('\n\n')
    const lastUserMessage = this.chatHistory.slice(-1).map(msg => msg.content).join('\n\n')

    return `### Request

${lastUserMessage}

${contextFileContents}

### Full Chat History Context

${allButLast}

### Current Request

${PREAMBLE}

${lastUserMessage}`
  }

  private handleClose() {
    console.log('Goodbye!')
    process.exit(0)
  }

  private handleKeypress(_: any, key: { name: string }) {
    if (key && (key.name === 'up' || key.name === 'down')) {
      if (key.name === 'up' && this.historyIndex < this.commandHistory.length - 1) {
        this.historyIndex++
      } else if (key.name === 'down' && this.historyIndex > -1) {
        this.historyIndex--
      }

      if (this.historyIndex >= 0) {
        this.rl.write(null, { ctrl: true, name: 'u' })
        this.rl.write(this.commandHistory[this.historyIndex])
      } else if (this.historyIndex === -1) {
        this.rl.write(null, { ctrl: true, name: 'u' })
      }
    }
  }
}

export default ChatManager
