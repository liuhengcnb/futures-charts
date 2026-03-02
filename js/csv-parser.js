// CSV解析工具类
class CSVParser {
    /**
     * 解析CSV文本为对象数组
     * @param {string} text CSV文本
     * @returns {Array} 解析后的数据数组
     */
    static parse(text) {
        const lines = text.split('\n').filter(line => line.trim());
        if (lines.length === 0) return [];
        
        // 解析表头
        const headers = this.parseLine(lines[0]);
        
        // 解析数据行
        const data = [];
        for (let i = 1; i < lines.length; i++) {
            const values = this.parseLine(lines[i]);
            if (values.length === headers.length) {
                const row = {};
                headers.forEach((header, index) => {
                    const value = values[index].trim();
                    // 尝试转换为数字
                    row[header.trim()] = this.parseValue(value);
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
        if (value === '' || value === 'nan' || value === 'NaN') {
            return null;
        }
        
        // 尝试解析为数字
        const num = parseFloat(value);
        if (!isNaN(num)) {
            return num;
        }
        
        return value;
    }

    /**
     * 获取CSV文件列表
     */
    static async getCSVList(dataPath = 'data/') {
        try {
            const response = await fetch(dataPath + 'manifest.json');
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            console.log('manifest.json not found, using default list');
        }
        
        // 如果没有manifest文件，返回空数组
        return [];
    }
}