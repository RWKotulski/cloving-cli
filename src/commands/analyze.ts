import readline from 'readline'
import { execFileSync } from 'child_process'

import { getGitDiff } from '../utils/git_utils'
import { getModel } from '../utils/model_utils'
import ClovingGPT from '../cloving_gpt'

const analyze = async () => {
  try {
    // Define the prompt for analysis
    const gitDiff = await getGitDiff()
    const model = getModel()

    const prompt = `Explain why the change is being made and document a description of these changes.
Also list any bugs in the new code as well as recommended fixes for those bugs with code examples.

${gitDiff}`

    // Instantiate ClovingGPT and get the analysis
    const gpt = new ClovingGPT()
    const analysis = await gpt.generateText({ prompt })

    // Print the analysis to the console
    console.log(analysis)

    // Prompt the user to copy the analysis to the clipboard
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    rl.question('Do you want to copy the analysis to the clipboard? [Y/n] ', (answer) => {
      if (answer.toLowerCase() === 'y' || answer === '') {
        try {
          execFileSync('pbcopy', { input: analysis })
          console.log('Analysis copied to clipboard')
        } catch (error) {
          console.error('Error: pbcopy command not found. Unable to copy to clipboard.')
        }
      }
      rl.close()
    })
  } catch (error) {
    console.error('Error during analysis:', (error as Error).message)
  }
}

export default analyze