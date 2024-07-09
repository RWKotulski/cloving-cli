import axios from 'axios'
import type { GPTRequest } from '../utils/types'
import readline from 'readline'
import { spawn } from 'child_process'
import process from 'process'
import { Adapter } from './adapters/'
import { ClaudeAdapter } from './adapters/claude'
import { OpenAIAdapter } from './adapters/openai'
import { GPT4AllAdapter } from './adapters/gpt4all'

class ClovingGPT {
  private adapter: Adapter
  private apiKey: string

  constructor() {
    const clovingModel = process.env.CLOVING_MODEL
    this.apiKey = (process.env.CLOVING_API_KEY || '').trim()

    if (!clovingModel || !this.apiKey) {
      throw new Error("CLOVING_MODEL and CLOVING_API_KEY environment variables must be set")
    }

    const [provider, model] = clovingModel.split(':')
    switch (provider) {
      case 'claude':
        this.adapter = new ClaudeAdapter(model)
        break
      case 'openai':
        this.adapter = new OpenAIAdapter(model)
        break
      case 'gpt4all':
        this.adapter = new GPT4AllAdapter(model)
        break
      default:
        throw new Error(`Unsupported provider: ${provider}`)
    }
  }

  private async askUserToConfirm(prompt: string, message: string): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    return new Promise((resolve) => {
      rl.question(message, (answer) => {
        rl.close()
        answer = answer.trim().toLowerCase()
        if (answer === 'y' || answer === '') {
          const less = spawn('less', ['-R'], { stdio: ['pipe', process.stdout, process.stderr] })

          less.stdin.write(prompt)
          less.stdin.end()

          less.on('close', (code) => {
            if (code !== 0) {
              console.error('less command exited with an error.')
              resolve(false)
              return
            }

            const rlConfirm = readline.createInterface({
              input: process.stdin,
              output: process.stdout
            })
            rlConfirm.question('Do you still want to continue? [Yn]: ', (confirmAnswer) => {
              rlConfirm.close()
              confirmAnswer = confirmAnswer.trim().toLowerCase()
              resolve(confirmAnswer === 'y' || confirmAnswer === '')
            })
          })

          less.stdin.on('error', (err) => {
            if (isNodeError(err) && err.code === 'EPIPE') {
              resolve(true)
            } else {
              console.error('Pipeline error:', err)
              resolve(false)
            }
          })
        } else {
          resolve(true)
        }
      })
    })
  }

  public async generateText(request: GPTRequest): Promise<string> {
    const tokenCount = Math.ceil(request.prompt.length / 4).toLocaleString()
    const shouldContinue = await this.askUserToConfirm(request.prompt, `Do you want to review the ~${tokenCount} token prompt before sending it to GPT? [Yn]: `)

    if (!shouldContinue) {
      console.log('Operation cancelled by the user.')
      process.exit(0)
    }

    const endpoint = this.adapter.getEndpoint()
    const payload = this.adapter.getPayload(request)
    const headers = this.adapter.getHeaders(this.apiKey)

    try {
      const response = await axios.post(endpoint, payload, { headers })
      return this.adapter.extractResponse(response.data)
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        console.error('Error generating or committing the message:', error.response.status, error.response.statusText)
        console.error('Response data:', error.response.data)
      } else {
        console.error('Error generating or committing the message:', (error as Error).message)
      }
      throw error
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

export default ClovingGPT