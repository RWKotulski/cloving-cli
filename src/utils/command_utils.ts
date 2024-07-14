import { spawn } from 'child_process'
import readline from 'readline'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { ClovingConfig } from '../utils/types'

export const CONFIG_PATH = path.join(os.homedir(), '.cloving.json')

export const runCommand = (command: string, args: string[]): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args)
    const output: string[] = []

    process.stdout.on('data', (data) => {
      output.push(data.toString())
    })

    process.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`)
    })

    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} process exited with code ${code}`))
      } else {
        resolve(output.join('').trim().split('\n'))
      }
    })
  })
}

export const promptUser = (question: string): Promise<string> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export const fetchModels = async (): Promise<string[]> => {
  try {
    const modelsOutput = await runCommand('cloving', ['models'])
    return modelsOutput
  } catch (error) {
    console.error('Error fetching models:', (error as Error).message)
    return []
  }
}

export const saveConfig = (config: ClovingConfig) => {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  console.log(`Configuration saved to ${CONFIG_PATH}`)
}

export const getConfig = (): ClovingConfig | null => {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const rawConfig = fs.readFileSync(CONFIG_PATH, 'utf-8')
      return JSON.parse(rawConfig)
    } catch (error) {
      console.error('Error parsing configuration file:', error)
      return null
    }
  }
  return null
}
