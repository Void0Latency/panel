// decode.js - برای دیکد کردن کد
const fs = require('fs');

const code = fs.readFileSync('voidlatency-core.js', 'utf8');

// استخراج payload و key
const payload = code.match(/const _0xPayload = "([^"]+)"/)?.[1];
const key = parseInt(code.match(/const _0xKey = (\d+);/)?.[1] || 105);

if (!payload) {
    console.log('❌ Payload not found!');
    process.exit(1);
}

// دیکد کردن
const bytes = [];
for (let i = 0; i < payload.length; i += 2) {
    bytes.push(parseInt(payload.substr(i, 2), 16) ^ key);
}

const decoded = new TextDecoder().decode(new Uint8Array(bytes));

// پیدا کردن کد اصلی
const start = decoded.indexOf('var __defProp');
if (start > 0) {
    const finalCode = decoded.slice(start);
    fs.writeFileSync('voidlatency-core-decoded.js', finalCode);
    console.log('✅ Decoded successfully!');
    console.log('📁 File: voidlatency-core-decoded.js');
    console.log('📏 Size:', finalCode.length, 'characters');
} else {
    fs.writeFileSync('voidlatency-core-decoded.js', decoded);
    console.log('✅ Decoded successfully! (full)');
}
