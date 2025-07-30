// File: indexer.ts

import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import * as lancedb from '@lancedb/lancedb';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

// --- CẤU HÌNH ---
const DB_PATH = 'lancedb_data';
const TABLE_NAME = 'code_chunks';
const PROJECT_PATH = process.argv[2];
const EMBEDDING_MODEL = 'embedding-001';
const API_KEY = process.env.API_KEY;

// --- KIỂM TRA ĐẦU VÀO ---
if (!PROJECT_PATH) {
  console.error("\nLỗi: Vui lòng cung cấp đường dẫn đến project.");
  console.log("-> Cách dùng: npx tsx indexer.ts ./sample-project\n");
  process.exit(1);
}
if (!API_KEY) {
    console.error("\nLỗi: Không tìm thấy API_KEY trong file .env\n");
    process.exit(1);
}

// --- KHỞI TẠO ---
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
const parser = new Parser();
parser.setLanguage(JavaScript);

// --- ĐỊNH NGHĨA KIỂU DỮ LIỆU ---
interface CodeChunk {
  symbolName: string;
  content: string;
  startLine: number;
  endLine: number;
}

interface CodeChunkData extends Record<string, unknown> {
  vector: number[];
  filePath: string;
  startLine: number;
  endLine: number;
  symbolName: string;
  language: string;
  content: string;
}

// --- LOGIC CHIA CHUNK ---
function findFunctionsAndClasses(node: Parser.SyntaxNode): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const nodeTypesToCapture = ['function_declaration', 'method_definition', 'class_declaration', 'arrow_function'];

    if (nodeTypesToCapture.includes(node.type)) {
        let symbolName = 'anonymous_function';
        const identifierNode = node.children.find(c => c.type === 'identifier' || c.type === 'property_identifier');
        if (identifierNode) {
          symbolName = identifierNode.text;
        }

        chunks.push({
          symbolName: symbolName,
          content: node.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
    }
    for (const child of node.children) {
        chunks.push(...findFunctionsAndClasses(child));
    }
    return chunks;
}

// --- HÀM CHÍNH ---
async function main() {
    console.time('TotalIndexingTime');
    console.log('Bắt đầu quá trình lập chỉ mục...');

    const db = await lancedb.connect(DB_PATH);
    const dataToInsert: CodeChunkData[] = [];

    const files = await glob(`${PROJECT_PATH}/**/*.js`, { ignore: '**/node_modules/**' });
    console.log(`=> Tìm thấy ${files.length} file Javascript để xử lý.`);

    for (const filePath of files) {
        console.log(`\n--- Đang xử lý file: ${filePath} ---`);
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const tree = parser.parse(fileContent);
        const chunks = findFunctionsAndClasses(tree.rootNode);
        console.log(`  Tìm thấy ${chunks.length} chunk(s) có ý nghĩa.`);

        for (const chunk of chunks) {
            console.log(`  -> Tạo embedding cho '${chunk.symbolName}'...`);
            const result = await model.embedContent(chunk.content);
            const embedding = result.embedding.values;
            dataToInsert.push({
                vector: embedding,
                filePath: path.relative(PROJECT_PATH, filePath),
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                symbolName: chunk.symbolName,
                language: 'javascript',
                content: chunk.content,
            });
            await new Promise(resolve => setTimeout(resolve, 200)); 
        }
    }

    if (dataToInsert.length > 0) {
        console.log(`\n=> Chuẩn bị chèn ${dataToInsert.length} chunk(s) vào LanceDB...`);
        try { await db.dropTable(TABLE_NAME); } catch (e) {}
        await db.createTable(TABLE_NAME, dataToInsert);
        console.log('✅ Tạo bảng và chèn dữ liệu thành công!');
    } else {
        console.log('⚠️ Không có chunk nào được tìm thấy.');
    }

    console.log('\n✨ Quá trình lập chỉ mục hoàn tất!');
    console.timeEnd('TotalIndexingTime');
}

main().catch(err => {
    console.error("\n❌ Đã xảy ra lỗi nghiêm trọng:", err);
    process.exit(1);
});