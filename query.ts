
import * as lancedb from '@lancedb/lancedb';
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import 'dotenv/config';
import chalk from 'chalk';
import { DB_PATH, TABLE_NAME, EMBEDDING_MODEL, CHAT_MODEL, TOP_K } from './config';

// --- HÀM TRUY VẤN CHÍNH ---
export async function runQuery(queryString: string) {
    const API_KEY = process.env.API_KEY;
    if (!API_KEY) {
        console.error(chalk.red("\nLỗi: Không tìm thấy API_KEY trong file .env\n"));
        return;
    }

    console.time(chalk.green('🚀 Tổng thời gian truy vấn'));
    console.log(chalk.blue.bold('--- BẮT ĐẦU TÌM KIẾM NGỮ NGHĨA ---'));
    console.log(chalk.gray(`   Câu hỏi: "${queryString}"\n`));

    const genAI = new GoogleGenerativeAI(API_KEY);
    const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    const chatModel = genAI.getGenerativeModel({ model: CHAT_MODEL });

    // 1. Tạo embedding cho câu hỏi
    console.log(chalk.cyan('1. Đang chuyển đổi câu hỏi thành vector...'));
    const result = await embeddingModel.embedContent({
        content: { 
            role: 'user',
            parts: [{ text: queryString }] 
        },
        taskType: TaskType.RETRIEVAL_QUERY,
    });
    const queryEmbedding = result.embedding.values;
    console.log(chalk.green('   => Chuyển đổi thành công.\n'));

    // 2. Tìm kiếm trong LanceDB
    console.log(chalk.cyan('2. Đang kết nối và tìm kiếm trong LanceDB...'));
    const db = await lancedb.connect(DB_PATH);
    let table;
    try {
        table = await db.openTable(TABLE_NAME);
    } catch (e) {
        console.error(chalk.red(`\n❌ Lỗi: Không thể mở bảng '${TABLE_NAME}'.`));
        console.error(chalk.yellow("-> Bạn đã chạy lệnh 'index' để tạo database chưa?\n"));
        return;
    }
    const searchResults = await table.search(queryEmbedding).limit(TOP_K).toArray();
    console.log(chalk.green(`   => Tìm thấy ${searchResults.length} kết quả liên quan nhất.\n`));

    if (searchResults.length === 0) {
        console.log(chalk.yellow("Không tìm thấy kết quả nào phù hợp trong database."));
        return;
    }

    // 3. Hiển thị kết quả và tổng hợp câu trả lời
    console.log(chalk.magenta('--- CÁC ĐOẠN CODE LIÊN QUAN NHẤT ĐƯỢC TÌM THẤY ---'));
    searchResults.forEach((row: any, index: number) => {
        console.log(chalk.yellow(`[${index + 1}] Score: ${row._distance.toFixed(4)} (càng nhỏ càng tốt) | Language: ${row.language}`));
        console.log(`   📂 ${chalk.bold('File:')} ${row.filePath} (Dòng ${row.startLine} - ${row.endLine})`);
        console.log(`   𝑓  ${chalk.bold('Symbol:')} ${row.symbolName}`);
        console.log(chalk.gray('   ----------------------------------------'));
    });
    console.log('');

    const contextString = searchResults.map((item: any, index) => `
--- Code Snippet ${index + 1} (${item.language}) ---
File: ${item.filePath}
Content:
\`\`\`${item.language}
${item.content}
\`\`\`
`).join('\n');

    const prompt = `Bạn là một trợ lý lập trình chuyên gia. Trả lời câu hỏi của người dùng dựa CHỈ vào các đoạn code được cung cấp dưới đây.\n\nCâu hỏi: "${queryString}"\n\nCác đoạn code liên quan:\n${contextString}`;
    
    console.log(chalk.cyan('3. Đang tổng hợp câu trả lời...'));
    const chatResult = await chatModel.generateContent(prompt);
    console.log(chalk.cyan.bold('\n--- CÂU TRẢ LỜI TỔNG HỢP ---'));
    console.log(chatResult.response.text());
    console.log('--------------------------------\n');

    console.timeEnd(chalk.green('🚀 Tổng thời gian truy vấn'));
}

// --- PHẦN ĐỂ CHẠY FILE NÀY ĐỘC LẬP ---
if (require.main === module) {
    const queryString = process.argv.slice(2).join(' ');
    if (!queryString) {
        console.error(chalk.red("\nLỗi: Vui lòng cung cấp câu hỏi."));
        console.log(chalk.yellow("-> Cách dùng: npx tsx query.ts \"câu hỏi của bạn\"\n"));
        process.exit(1);
    }
    runQuery(queryString).catch(err => {
        console.error(chalk.red.bold("\n❌ Đã xảy ra lỗi khi truy vấn:"), err);
        process.exit(1);
    });
}