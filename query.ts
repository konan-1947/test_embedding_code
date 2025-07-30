// File: query.ts

import * as lancedb from '@lancedb/lancedb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

// --- CẤU HÌNH ---
const DB_PATH = 'lancedb_data';
const TABLE_NAME = 'code_chunks';
const EMBEDDING_MODEL = 'text-embedding-004';
const API_KEY = process.env.API_KEY;
const QUERY = process.argv.slice(2).join(' ');
const TOP_K = 5;

// --- KIỂM TRA ĐẦU VÀO ---
if (!QUERY) {
  console.error("\nLỗi: Vui lòng cung cấp câu hỏi.");
  console.log("-> Cách dùng: npx tsx query.ts làm thế nào để đăng nhập\n");
  process.exit(1);
}
if (!API_KEY) {
    console.error("\nLỗi: Không tìm thấy API_KEY trong file .env\n");
    process.exit(1);
}

// --- KHỞI TẠO ---
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

// --- HÀM TÌM KIẾM ---
async function search() {
  console.log(`Đang tìm kiếm cho câu hỏi: "${QUERY}"`);
  const result = await model.embedContent(QUERY);
  const queryEmbedding = result.embedding.values;

  const db = await lancedb.connect(DB_PATH);
  // Thêm try-catch để xử lý trường hợp bảng chưa tồn tại
  let table;
  try {
      table = await db.openTable(TABLE_NAME);
  } catch (e) {
      console.error(`\n❌ Lỗi: Không thể mở bảng '${TABLE_NAME}'.`);
      console.error("-> Bạn đã chạy 'npx tsx indexer.ts ./sample-project' để tạo database chưa?\n");
      process.exit(1);
  }

  console.log('Đang tìm kiếm trong database...');
  
  // Lấy tất cả dữ liệu và tìm kiếm trực tiếp
  const allData = await table.query().toArray();
  console.log(`\n--- TOP ${TOP_K} KẾT QUẢ PHÙ HỢP NHẤT ---\n`);
  
  // Tìm kiếm trực tiếp trong dữ liệu
  const resultsArray = allData.filter(item => 
    item.symbolName.toLowerCase().includes(QUERY.toLowerCase()) ||
    item.content.toLowerCase().includes(QUERY.toLowerCase())
  ).slice(0, TOP_K);
  
  if (resultsArray.length === 0) {
    console.log("Không tìm thấy kết quả nào phù hợp trong database.");
    return;
  }
  
  resultsArray.forEach((row: any, index: number) => {
    console.log(`[${index + 1}] KẾT QUẢ (Score: ${row._distance?.toFixed(4) || 'N/A'}) - Càng nhỏ càng tốt`);
    console.log(`   📂 File: ${row.filePath || 'N/A'} (Dòng ${row.startLine || 'N/A'} - ${row.endLine || 'N/A'})`);
    console.log(`   𝑓  Symbol: ${row.symbolName || 'N/A'}`);
    console.log('   -------------------------------------------------');
    console.log((row.content as string || 'N/A').split('\n').map(line => `   | ${line}`).join('\n'));
    console.log('   -------------------------------------------------\n');
  });
}

search().catch(err => {
    console.error("\n❌ Đã xảy ra lỗi khi tìm kiếm:", err);
    process.exit(1);
});