// File: run.ts

import chalk from 'chalk';
import { execSync } from 'child_process';
import { runIndexer } from './indexer';
import { runQuery } from './query';

function buildParsers() {
    console.log(chalk.blue.bold('--- Kiểm tra và Biên dịch Parsers (nếu cần) ---'));
    try {
        // Lệnh build này sẽ tạo file .wasm ở thư mục gốc
        const buildCommand = "tree-sitter build --wasm parsers/tree-sitter-javascript && tree-sitter build --wasm parsers/tree-sitter-typescript/typescript && tree-sitter build --wasm parsers/tree-sitter-python && tree-sitter build --wasm parsers/tree-sitter-html && tree-sitter build --wasm parsers/tree-sitter-css && tree-sitter build --wasm parsers/tree-sitter-json";
        
        // Script Node.js để di chuyển file, hoạt động trên mọi HĐH
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

        console.log(chalk.gray('   - Đang chạy lệnh build...'));
        execSync(buildCommand, { stdio: 'pipe' });
        
        console.log(chalk.gray('   - Đang di chuyển file .wasm...'));
        execSync(`node -e "${moveScript.replace(/\n/g, '')}"`, { stdio: 'pipe' });

        console.log(chalk.green.bold('✅ Quá trình build hoàn tất!\n'));
    } catch (error) {
        // Bỏ qua lỗi nếu không có gì để build/move
        console.log(chalk.gray('   - Không có parser mới nào được biên dịch hoặc đã xảy ra lỗi nhỏ. Bỏ qua.\n'));
    }
}

async function main() {
    const command = process.argv[2];
    const argument = process.argv.slice(3).join(' ');

    console.log(chalk.inverse('\n--- Trợ Lý Code Đa Năng ---'));

    try {
        if (command === 'build') {
            buildParsers();
        } else if (command === 'index') {
            if (!argument) {
                console.error(chalk.red("Lỗi: Vui lòng cung cấp đường dẫn đến project."));
                console.log(chalk.yellow("-> Cách dùng: npx tsx run.ts index ./sample-project"));
                return;
            }
            buildParsers(); // Luôn kiểm tra build trước khi index
            await runIndexer(argument);
        } else if (command === 'query') {
            if (!argument) {
                console.error(chalk.red("Lỗi: Vui lòng cung cấp câu hỏi."));
                console.log(chalk.yellow("-> Cách dùng: npx tsx run.ts query \"câu hỏi của bạn\""));
                return;
            }
            await runQuery(argument);
        } else {
            console.log(chalk.yellow("\nLệnh không hợp lệ. Các lệnh có sẵn:"));
            console.log(chalk.green("  build                      ") + "- Biên dịch các parser (chạy riêng nếu cần).");
            console.log(chalk.green("  index <path_to_project>    ") + "- Để lập chỉ mục cho một project.");
            console.log(chalk.green("  query \"<your_question>\"    ") + "- Để đặt câu hỏi.");
        }
    } catch (error) {
        console.error(chalk.red.bold("\n❌ Đã xảy ra lỗi không mong muốn:"), error);
    }
}

main();