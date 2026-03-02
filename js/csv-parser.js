// js/csv-parser.js

class CSVParser {
    /**
     * 解析CSV文本为对象数组
     */
    static parse(text) {
        // 1. 去除可能存在的BOM头 (Python utf-8-sig 会生成这个)
        if (text.charCodeAt(0) === 0xFEFF) {
            text = text.slice(1);
        }

        const lines = text.split('\n').filter(line => line.trim());
        if (lines.length === 0) return [];
        
        // 2. 解析表头
        const headers = this.parseLine(lines[0]);
        
        // 3. 解析数据行
        const data = [];
        for (let i = 1; i < lines.length; i++) {
            const values = this.parseLine(lines[i]);
            // 只有当值的数量和表头数量匹配时才处理（防止空行或格式错误）
            if (values.length === headers.length) {
                const row = {};
                headers.forEach((header, index) => {
                    const cleanHeader = header.trim(); // 去除表头空格
                    const value = values[index].trim();
                    row[cleanHeader] = this.parseValue(value);
                });
                data.push(row);
            }
        }
        
        return data;
    }

    /**
     * 解析CSV行（处理引号内的逗号）
     */
    static parseLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        
        return result;
    }

    /**
     * 解析值（转换为合适的类型）
     */
    static parseValue(value) {
        if (value === '' || value === 'nan' || value === 'NaN' || value === 'None') {
            return null;
        }
        
        // 尝试解析为数字
        const num = parseFloat(value);
        if (!isNaN(num)) {
            return num;
        }
        
        return value;
    }
}