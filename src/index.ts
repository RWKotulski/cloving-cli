#!/usr/bin/env node

import { Command } from 'commander'
import { readFileSync } from 'fs'
import { join } from 'path'
import config from './commands/config'
import init from './commands/init'
import models from './commands/models'
import sh from './commands/generate/sh'
import commit from './commands/generate/commit'
import unitTests from './commands/generate/unit_tests'
import analyze from './commands/generate/review'
import initProject from './commands/project/init'
import planProject from './commands/project/plan'
import buildProject from './commands/project/build'
import completeProject from './commands/project/complete'

// Function to get version from package.json
const getPackageVersion = () => {
  const packagePath = join(__dirname, 'package.json')
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
  return packageJson.version
}

const program = new Command()

program
  .name('cloving')
  .description('Integrate AI into your development workflow for generating commit messages, code reviews, and unit tests.')
  .version(getPackageVersion())

program
  .command('config')
  .description('Configure cloving with your API key and models to use')
  .action(config)

program
  .command('init')
  .description('Setup cloving in the current directory')
  .option('-s, --silent', 'Run the command without asking for confirmation of submitting prompts')
  .option('-m, --model <model>', 'Select the model to use (e.g., openai, claude, ollama, ollama:llama3, claude:claude-3-5-sonnet-20240620)')
  .action(init)

program
  .command('models')
  .description('List available models')
  .action(models)

program
  .command('commit')
  .description('Alias for cloving generate commit')
  .option('-s, --silent', 'Run the command without asking for confirmation of submitting prompts')
  .option('-m, --model <model>', 'Select the model to use (e.g., openai, claude, ollama, ollama:llama3, claude:claude-3-5-sonnet-20240620)')
  .action(commit)

// Generate commands
const generate = program
  .command('generate')
  .alias('g')
  .description('Generate various items like unit-tests and code reviews')

generate
  .command('sh')
  .description('Generate a shell command based on a prompt')
  .option('-s, --silent', 'Run the command without asking for confirmation of submitting prompts')
  .option('-m, --model <model>', 'Select the model to use (e.g., openai, claude, ollama, ollama:llama3, claude:claude-3-5-sonnet-20240620)')
  .option('-p, --prompt <prompt>', 'Specify the prompt to use')
  .action(sh)

generate
  .command('commit')
  .description('Generate a commit message and commit the changes')
  .option('-s, --silent', 'Run the command without asking for confirmation of submitting prompts')
  .option('-m, --model <model>', 'Select the model to use (e.g., openai, claude, ollama, ollama:llama3, claude:claude-3-5-sonnet-20240620)')
  .action(commit)

generate
  .command('unit-tests')
  .description('Generate unit tests (if you don\'t specify filenames, it will generate tests for commited changes that differ from the main/master branch)')
  .option('-s, --silent', 'Run the command without asking for confirmation of submitting prompts')
  .option('-f, --files <filenames...>', 'Specify filenames for the unit tests')
  .option('-m, --model <model>', 'Select the model to use (e.g., openai, claude, ollama, ollama:llama3, claude:claude-3-5-sonnet-20240620)')
  .action(unitTests)

generate
  .command('review')
  .description('Review the code for commited changes that differ from the main/master branch')
  .option('-s, --silent', 'Run the command without asking for confirmation of submitting prompts')
  .option('-m, --model <model>', 'Select the model to use (e.g., openai, claude, ollama, ollama:llama3, claude:claude-3-5-sonnet-20240620)')
  .action(analyze)

// Project commands
const project = program
  .command('project')
  .description('Commands for cloving a project')

project
  .command('init')
  .description('Setup a new cloving project inside a git branch')
  .action(initProject)

project
  .command('plan')
  .description('Plan the steps to complete the project')
  .action(planProject)

project
  .command('build')
  .description('Generate code to build the project')
  .action(buildProject)

project
  .command('complete')
  .description('Clean up and finalize the project')
  .action(completeProject)

program.parse(process.argv)
