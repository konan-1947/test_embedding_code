// File: run.ts

import chalk from 'chalk';
import { execSync } from 'child_process';
import { runIndexer } from './indexer';
import { runQuery } from './query';

function buildParsers() {
    console.log(chalk.blue.bold('--- Check and Build Parsers (if needed) ---'));
    try {
        // This build command will create .wasm files in the root directory
        const buildCommand = "tree-sitter build --wasm parsers/tree-sitter-javascript && tree-sitter build --wasm parsers/tree-sitter-typescript/typescript && tree-sitter build --wasm parsers/tree-sitter-python && tree-sitter build --wasm parsers/tree-sitter-html && tree-sitter build --wasm parsers/tree-sitter-css && tree-sitter build --wasm parsers/tree-sitter-json";
        
        // Node.js script to move files, works on all OS
        const moveScript = `
            const fs = require('fs');
            const path = require('path');
            const wasmDir = path.join(process.cwd(), 'wasm');
            if (!fs.existsSync(wasmDir)) fs.mkdirSync(wasmDir);
            fs.readdirSync(process.cwd()).forEach(file => {
                if (file.endsWith('.wasm')) {
                    fs.renameSync(path.join(process.cwd(), file), path.join(wasmDir, file));
                }
            });
        `;

        console.log(chalk.gray('   - Running build command...'));
        execSync(buildCommand, { stdio: 'pipe' });
        
        console.log(chalk.gray('   - Moving .wasm files...'));
        execSync(`node -e "${moveScript.replace(/\n/g, '')}"`, { stdio: 'pipe' });

        console.log(chalk.green.bold('✅ Build process complete!\n'));
    } catch (error) {
        // Ignore errors if there's nothing to build/move
        console.log(chalk.gray('   - No new parsers were compiled or a minor error occurred. Skipping.\n'));
    }
}

async function main() {
    const command = process.argv[2];
    const argument = process.argv.slice(3).join(' ');

    console.log(chalk.inverse('\n--- Versatile Code Assistant ---\n'));

    try {
        if (command === 'build') {
            buildParsers();
        } else if (command === 'index') {
            if (!argument) {
                console.error(chalk.red("Error: Please provide the path to the project."));
                console.log(chalk.yellow("-> Usage: npx tsx run.ts index ./sample-project"));
                return;
            }
            buildParsers(); // Always check build before indexing
            await runIndexer(argument);
        } else if (command === 'query') {
            if (!argument) {
                console.error(chalk.red("Error: Please provide a question."));
                console.log(chalk.yellow("-> Usage: npx tsx run.ts query \"your question\""));
                return;
            }
            await runQuery(argument);
        } else {
            console.log(chalk.yellow("\nInvalid command. Available commands:"));
            console.log(chalk.green("  build                      ") + "- Build the parsers (run separately if needed).");
            console.log(chalk.green("  index <path_to_project>    ") + "- To index a project.");
            console.log(chalk.green("  query \"<your_question>\"    ") + "- To ask a question.");
        }
    } catch (error) {
        console.error(chalk.red.bold("\n❌ An unexpected error occurred:"), error);
    }
}

main();