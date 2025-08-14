// File: indexer.ts

import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import * as lancedb from '@lancedb/lancedb';
// [GIẢI PHÁP CUỐI CÙNG] Sử dụng require() để nạp module CommonJS một cách trực tiếp
const Parser = require('tree-sitter');
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import 'dotenv/config';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import { DB_PATH, TABLE_NAME, EMBEDDING_MODEL, BATCH_SIZE } from './config';

// --- ĐỊNH NGHĨA CẤU HÌNH VÀ KIỂU DỮ LIỆU ---
interface LanguageConfig {
    parser: any; 
    extensions: string[];
    nodeTypesToCapture: string[];
    getSymbolName: (node: any) => string;
}

interface CodeChunk {
  filePath: string;
  symbolName: string;
  content: string;
  startLine: number;
  endLine: number;
  language: string;
}

interface CodeChunkData extends Omit<CodeChunk, 'language'> {
  vector: number[];
  language: string;
}

// --- CÁC HÀM TIỆN ÍCH ---
async function loadLanguageConfigurations(): Promise<Record<string, LanguageConfig>> {
    await Parser.init();
    const Language = Parser.Language;

    const wasmDir = path.join(__dirname, 'wasm');
    const getIdentifierName = (node: any) => node.childForFieldName('name')?.text || 'anonymous';

    return {
        javascript: {
            parser: await Language.load(path.join(wasmDir, 'tree-sitter-javascript.wasm')),
            extensions: ['.js', '.jsx', '.mjs', '.cjs'],
            nodeTypesToCapture: ['function_declaration', 'method_definition', 'class_declaration', 'arrow_function', 'function_expression'],
            getSymbolName: getIdentifierName,
        },
        typescript: {
            parser: await Language.load(path.join(wasmDir, 'tree-sitter-typescript.wasm')),
            extensions: ['.ts', '.tsx'],
            nodeTypesToCapture: ['function_declaration', 'method_definition', 'class_declaration', 'arrow_function', 'function_expression', 'interface_declaration', 'type_alias_declaration'],
            getSymbolName: getIdentifierName,
        },
        python: {
            parser: await Language.load(path.join(wasmDir, 'tree-sitter-python.wasm')),
            extensions: ['.py'],
            nodeTypesToCapture: ['function_definition', 'class_definition'],
            getSymbolName: getIdentifierName,
        },
        html: {
            parser: await Language.load(path.join(wasmDir, 'tree-sitter-html.wasm')),
            extensions: ['.html', '.htm'],
            nodeTypesToCapture: ['script_element', 'style_element', 'element'],
            getSymbolName: (node: any) => node.firstChild?.text || 'html_element',
        },
        css: {
            parser: await Language.load(path.join(wasmDir, 'tree-sitter-css.wasm')),
            extensions: ['.css'],
            nodeTypesToCapture: ['rule_set', 'media_statement'],
            getSymbolName: (node: any) => node.firstChild?.text.split('{')[0].trim() || 'css_rule',
        },
        json: {
            parser: await Language.load(path.join(wasmDir, 'tree-sitter-json.wasm')),
            extensions: ['.json', '.jsonc'],
            nodeTypesToCapture: ['pair'],
            getSymbolName: (node: any) => node.childForFieldName('key')?.text.replace(/"/g, '') || 'json_pair',
        },
    };
}

function extractChunks(node: any, config: LanguageConfig): Omit<CodeChunk, 'filePath' | 'language'>[] {
    const chunks: Omit<CodeChunk, 'filePath' | 'language'>[] = [];
    if (config.nodeTypesToCapture.includes(node.type)) {
        chunks.push({
          symbolName: config.getSymbolName(node),
          content: node.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
    } else {
        for (const child of node.children) {
            chunks.push(...extractChunks(child, config));
        }
    }
    return chunks;
}

// --- HÀM CHÍNH ĐỂ LẬP CHỈ MỤC ---
export async function runIndexer(projectPath: string) {
    const API_KEY = process.env.API_KEY;
    if (!API_KEY) {
        console.error(chalk.red("\nLỗi: Không tìm thấy API_KEY trong file .env\n"));
        return;
    }

    console.time(chalk.green('🚀 Tổng thời gian lập chỉ mục'));
    console.log(chalk.blue.bold('\n--- BẮT ĐẦU QUÁ TRÌNH LẬP CHỈ MỤC (WASM) ---'));

    // 1. Nạp parser
    console.log(chalk.cyan('1. Đang nạp các parser từ WebAssembly...'));
    const languageConfigs = await loadLanguageConfigurations();
    const extensionToLanguageMap: Record<string, string> = {};
    for (const lang in languageConfigs) {
        for (const ext of languageConfigs[lang].extensions) {
            extensionToLanguageMap[ext] = lang;
        }
    }
    console.log(chalk.green('   => Nạp parser thành công!\n'));

    // 2. Quét file và phân tích
    const mainParser = new Parser();
    const supportedExtensions = Object.keys(extensionToLanguageMap).map(ext => ext.slice(1));
    const globPattern = `${projectPath}/**/*.{${supportedExtensions.join(',')}}`;
    console.log(chalk.cyan('2. Đang quét file và phân tích code...'));
    const files = await glob(globPattern, { ignore: ['**/node_modules/**', '**/.git/**'] });
    console.log(chalk.green(`   => Tìm thấy ${files.length} file.`));

    const allChunks: CodeChunk[] = [];
    for (const filePath of files) {
        const fileExtension = path.extname(filePath);
        const languageName = extensionToLanguageMap[fileExtension];
        if (!languageName) continue;

        const config = languageConfigs[languageName];
        mainParser.setLanguage(config.parser);
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const tree = mainParser.parse(fileContent);
        const chunksFromFile = extractChunks(tree.rootNode, config);
        for (const chunk of chunksFromFile) {
            allChunks.push({ ...chunk, filePath: path.relative(projectPath, filePath), language: languageName });
        }
    }
    console.log(chalk.green(`   => Phân tích xong, tìm thấy tổng cộng ${allChunks.length} chunk code.\n`));

    if (allChunks.length === 0) {
        console.log(chalk.yellow('⚠️ Không có chunk code nào được tìm thấy.'));
        return;
    }

    // 3. Tạo embedding và lưu vào DB
    const genAI = new GoogleGenerativeAI(API_KEY);
    const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    console.log(chalk.cyan('3. Đang tạo vector embedding...'));
    const dataToInsert: CodeChunkData[] = [];
    const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progressBar.start(allChunks.length, 0);
    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
        const batchChunks = allChunks.slice(i, i + BATCH_SIZE);
        const batchRequests = batchChunks.map(chunk => ({
            content: { parts: [{ text: chunk.content }] },
            taskType: TaskType.RETRIEVAL_DOCUMENT,
            title: `${chunk.language} ${chunk.symbolName} in ${chunk.filePath}`,
        }));
        const result = await embeddingModel.batchEmbedContents({ requests: batchRequests });
        result.embeddings.forEach((embedding, index) => {
            const originalChunk = batchChunks[index];
            dataToInsert.push({
                vector: embedding.values,
                filePath: originalChunk.filePath,
                startLine: originalChunk.startLine,
                endLine: originalChunk.endLine,
                symbolName: originalChunk.symbolName,
                language: originalChunk.language,
                content: originalChunk.content,
            });
            progressBar.increment();
        });
    }
    progressBar.stop();
    console.log(chalk.green('   => Tạo embedding hoàn tất!\n'));

    // 4. Lưu vào LanceDB
    console.log(chalk.cyan('4. Đang lưu dữ liệu vào LanceDB...'));
    const db = await lancedb.connect(DB_PATH);
    try { await db.dropTable(TABLE_NAME); } catch (e) {}
    await db.createTable(TABLE_NAME, dataToInsert);
    console.log(chalk.green.bold('   ✅ Lưu vào cơ sở dữ liệu thành công!\n'));

    console.log(chalk.magenta.bold('✨ Quá trình lập chỉ mục hoàn tất! ✨'));
    console.timeEnd(chalk.green('🚀 Tổng thời gian lập chỉ mục'));
}

// --- PHẦN ĐỂ CHẠY FILE NÀY ĐỘC LẬP ---
if (require.main === module) {
    const projectPath = process.argv[2];
    if (!projectPath) {
        console.error(chalk.red("\nLỗi: Vui lòng cung cấp đường dẫn đến project."));
        console.log(chalk.yellow("-> Cách dùng: npx tsx indexer.ts ./sample-project\n"));
        process.exit(1);
    }
    runIndexer(projectPath).catch(err => {
        console.error(chalk.red.bold("\n❌ Đã xảy ra lỗi nghiêm trọng khi lập chỉ mục:"), err);
        process.exit(1);
    });
}