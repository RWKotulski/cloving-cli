import { execFileSync } from 'child_process'
import highlight from 'cli-highlight'
import inquirer from 'inquirer'
import ncp from 'copy-paste'

import ClovingGPT from '../../cloving_gpt'
import { getGitDiff } from '../../utils/git_utils'
import { extractMarkdown } from '../../utils/string_utils'
import { getConfig } from '../../utils/config_utils'
import { parseMarkdownInstructions } from '../../utils/string_utils'
import type { ClovingGPTOptions } from '../../utils/types'

const review = async (options: ClovingGPTOptions) => {
  options.silent = getConfig(options).globalSilent || false
  const gpt = new ClovingGPT(options)

  try {
    // Define the prompt for analysis
    const gitDiff = await getGitDiff()

    const prompt = `==== begin diff =====
${gitDiff}
==== end diff =====

Explain why these change are being made and document a description of these changes.
Also list any bugs in the new code as well as recommended fixes for those bugs with code examples.
Format the output of this code review in Markdown format.`

    // get the analysis
    const analysis = await gpt.generateText({ prompt })

    // Print the analysis to the console
    parseMarkdownInstructions(analysis).map(code => {
      if (code.trim().startsWith('```')) {
        const lines = code.split('\n')
        const language = code.match(/```(\w+)/)?.[1] || 'plaintext'
        console.log(lines[0])
        console.log(highlight(lines.slice(1, -1).join('\n'), { language }))
        console.log(lines.slice(-1)[0])
      } else {
        console.log(highlight(code, { language: 'markdown' }))
      }
    })

    // Prompt the user to copy the analysis to the clipboard
    const { copyToClipboard } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'copyToClipboard',
        message: 'Do you want to copy the analysis to the clipboard?',
        default: true
      }
    ])

    if (copyToClipboard) {
      ncp.copy(analysis, (err) => {
        if (err) {
          console.error('Error: Unable to copy to clipboard.', err)
        } else {
          console.log('Analysis copied to clipboard')
        }
      })
    }
  } catch (error) {
    console.error('Error during analysis:', (error as Error).message)
  }
}

export default review