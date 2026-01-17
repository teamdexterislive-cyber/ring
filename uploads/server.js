import express from "express";
import multer from "multer";
import pkg from "pg";
import cors from "cors";
const { Pool } = pkg;

// Configure multer with file size limits
const upload = multer({
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB default
    }
});

const app = express();
app.use(cors());
app.use(express.json());

const TABLE_NAME = "Ring";
const schema = {
  "name": {
    "type": "text",
    "limit": "20",
    "scale": "",
    "required": true,
    "unique": false,
    "allowNegative": true,
    "fileConfig": null
  },
  "phone": {
    "type": "phone",
    "limit": "10",
    "scale": "",
    "required": true,
    "unique": false,
    "allowNegative": false,
    "fileConfig": null
  },
  "email": {
    "type": "email",
    "limit": "",
    "scale": "",
    "required": false,
    "unique": false,
    "allowNegative": false,
    "fileConfig": null
  },
  "ring_size": {
    "type": "amount",
    "limit": "10",
    "scale": "2",
    "required": true,
    "unique": false,
    "allowNegative": true,
    "fileConfig": null
  },
  "ss": {
    "type": "photo",
    "limit": "",
    "scale": "",
    "required": true,
    "unique": false,
    "allowNegative": false,
    "fileConfig": {
      "maxSize": 10,
      "extensions": "all"
    }
  },
  "caret": {
    "type": "number",
    "limit": "2",
    "scale": "",
    "required": true,
    "unique": false,
    "allowNegative": true,
    "fileConfig": null
  },
  "aadhar": {
    "type": "photo",
    "limit": "",
    "scale": "",
    "required": true,
    "unique": false,
    "allowNegative": false,
    "fileConfig": {
      "maxSize": 10,
      "extensions": "all"
    }
  }
};
const AUTO_CREATED_AT = true;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Type mapping for SQL
const typeMap = {
    text: field => `VARCHAR(${field.limit || 50})`,
    description: field => `VARCHAR(${field.limit || 500})`,
    number: field => {
        const digits = parseInt(field.limit, 10) || 10;
        if (digits <= 9) return "INTEGER";
        if (digits <= 18) return "BIGINT";
        return `NUMERIC(${digits})`;
    },
    amount: field => `DECIMAL(${field.limit || 10}, ${field.scale || 2})`,
    yesno: () => "BOOLEAN",
    datetime: () => "TIMESTAMP",
    date: () => "DATE",
    email: () => "VARCHAR(255)",
    phone: field => `VARCHAR(${field.limit || 15})`,
    url: () => "VARCHAR(500)",
    photo: () => "BYTEA",
    file: () => "BYTEA"
};

// Create table SQL
function createTableSQL() {
    let columns = '"id" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n';
    
    for (const [name, field] of Object.entries(schema)) {
        columns += `"${name}" ${typeMap[field.type](field)}`;
        
        if (field.required) {
            columns += ` NOT NULL`;
        }
        
        if (field.unique) {
            columns += ` UNIQUE`;
        }
        
        columns += `,\n`;
    }
    
    if (AUTO_CREATED_AT) {
        columns += '"created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\n';
    }
    
    return `CREATE TABLE IF NOT EXISTS "${TABLE_NAME}" (\n${columns.slice(0, -2)}\n);`;
}

// File validation
function validateFile(file, fieldConfig) {
    if (!file) return null;
    
    const maxSize = (fieldConfig.limit || 10) * 1024 * 1024;
    if (file.size > maxSize) {
        return `File size exceeds ${fieldConfig.limit || 10}MB limit`;
    }
    
    if (fieldConfig.fileConfig && fieldConfig.fileConfig.extensions !== 'all') {
        const fileName = file.originalname.toLowerCase();
        const isValid = fieldConfig.fileConfig.extensions.some(ext => 
            fileName.endsWith(ext.toLowerCase())
        );
        
        if (!isValid) {
            const allowed = fieldConfig.fileConfig.extensions.map(e => e.replace('.', '')).join(', ');
            return `File type not allowed. Allowed types: ${allowed}`;
        }
    }
    
    return null;
}

// Field validation
function validate(body, files) {
    // Required field validation
    for (const [name, field] of Object.entries(schema)) {
        if (field.type === "photo" || field.type === "file") {
            if (field.required && !files[name]) {
                return { error: `${name} is required`, field: name };
            }
            
            // File validation
            if (files[name]) {
                const fileError = validateFile(files[name][0], field);
                if (fileError) {
                    return { error: fileError, field: name };
                }
            }
        } else {
            const value = body[name];
            if (field.required && (value === undefined || value === null || String(value).trim() === "")) {
                return { error: `${name} is required`, field: name };
            }
            
            // Skip validation if value is empty and not required
            if (value === undefined || value === null || String(value).trim() === "") {
                continue;
            }
            
            const strValue = String(value).trim();
            
            // Email validation
            if (field.type === "email") {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(strValue)) {
                    return { error: `${name} must be a valid email address`, field: name };
                }
            }
            
            // URL validation
            if (field.type === "url") {
                try {
                    new URL(strValue);
                } catch {
                    return { error: `${name} must be a valid URL`, field: name };
                }
            }
            
            // Phone validation
            if (field.type === "phone") {
                const phoneRegex = /^[+]?[\d\s\-\(\)]{10,15}$/;
                if (!phoneRegex.test(strValue.replace(/\s/g, ''))) {
                    return { error: `${name} must be a valid phone number`, field: name };
                }
                
                const maxLength = parseInt(field.limit) || 15;
                if (strValue.replace(/[^\d]/g, '').length > maxLength) {
                    return { error: `${name} exceeds ${maxLength} digits`, field: name };
                }
            }
            
            // Text length validation
            if ((field.type === "text" || field.type === "description") && field.limit) {
                const maxLength = parseInt(field.limit);
                if (strValue.length > maxLength) {
                    return { error: `${name} exceeds ${maxLength} characters`, field: name };
                }
            }
            
            // Numeric validation
            if ((field.type === "number" || field.type === "amount") && strValue !== "") {
                // Check if it's a valid number
                if (!/^-?\d+(\.\d+)?$/.test(strValue)) {
                    return { error: `${name} must be a valid number`, field: name };
                }
                
                // Fix: Reject decimals for integer fields
                if (field.type === "number" && strValue.includes(".")) {
                    return { error: `${name} must be an integer (no decimals)`, field: name };
                }
                
                // Negative validation
                if (!field.allowNegative && strValue.startsWith("-")) {
                    return { error: `${name} must be a positive number`, field: name };
                }
                
                // Number range validation
                if (field.type === "number") {
                    const numValue = Math.abs(parseInt(strValue));
                    const maxDigits = parseInt(field.limit) || 10;
                    
                    // Check if number fits in the allowed digits
                    if (String(numValue).length > maxDigits) {
                        return { error: `${name} exceeds ${maxDigits} digits`, field: name };
                    }
                    
                    // Check PostgreSQL integer limits
                    if (maxDigits <= 9 && numValue > 2147483647) {
                        return { error: `${name} exceeds INTEGER maximum value`, field: name };
                    }
                    
                    if (maxDigits <= 18 && numValue > 9223372036854775807) {
                        return { error: `${name} exceeds BIGINT maximum value`, field: name };
                    }
                }
                
                // Amount precision validation
                if (field.type === "amount") {
                    const [integerPart = "", decimalPart = ""] = strValue.replace("-", "").split(".");
                    const maxInteger = parseInt(field.limit || 10, 10) - parseInt(field.scale || 2, 10);
                    const maxDecimal = parseInt(field.scale || 2, 10);
                    
                    if (integerPart.length > maxInteger) {
                        return { error: `${name} integer part exceeds ${maxInteger} digits`, field: name };
                    }
                    if (decimalPart.length > maxDecimal) {
                        return { error: `${name} decimal part exceeds ${maxDecimal} places`, field: name };
                    }
                    
                    // Negative validation for amount
                    if (!field.allowNegative && strValue.startsWith("-")) {
                        return { error: `${name} must be a positive amount`, field: name };
                    }
                }
            }
            
            // Date validation
            if ((field.type === "datetime" || field.type === "date") && strValue !== "") {
                const dateValue = new Date(strValue);
                if (isNaN(dateValue.getTime())) {
                    return { error: `${name} must be a valid date`, field: name };
                }
            }
        }
    }
    
    // Extra field validation
    for (const key of Object.keys(body)) {
        if (!schema[key]) {
            return { error: `Extra field not allowed: ${key}`, field: key };
        }
    }
    
    // Extra file validation
    for (const key of Object.keys(files)) {
        if (!schema[key] || (schema[key].type !== "photo" && schema[key].type !== "file")) {
            return { error: `Extra file not allowed: ${key}`, field: key };
        }
    }
    
    return null;
}

// Build insert query
function buildInsertQuery(body, files) {
    const columns = [];
    const values = [];
    let paramIndex = 1;
    
    for (const [name, field] of Object.entries(schema)) {
        if (field.type === "photo" || field.type === "file") {
            if (files[name]) {
                columns.push(`"${name}"`);
                values.push(files[name][0].buffer);
                paramIndex++;
            } else if (field.required) {
                throw { error: `${name} is required`, field: name };
            }
        } else {
            if (!(name in body)) {
                if (field.required) {
                    throw { error: `${name} is required`, field: name };
                }
                continue;
            }
            
            columns.push(`"${name}"`);
            
            // Type conversion with validation
            let value = body[name];
            if (field.type === "number") {
                // Ensure it's an integer
                const num = parseFloat(value);
                if (!Number.isInteger(num)) {
                    throw { error: `${name} must be an integer`, field: name };
                }
                value = Math.floor(num);
            } else if (field.type === "amount") {
                value = parseFloat(value);
            } else if (field.type === "yesno") {
                value = String(value).toLowerCase() === "true" || 
                        value === "1" || 
                        value === 1 || 
                        value === "yes" ||
                        value === "on";
            } else if (field.type === "text" || field.type === "description" || field.type === "email" || 
                      field.type === "phone" || field.type === "url") {
                value = String(value).trim();
            } else if (field.type === "datetime" || field.type === "date") {
                // Ensure valid date format for PostgreSQL
                const date = new Date(value);
                if (isNaN(date.getTime())) {
                    throw { error: `${name} must be a valid date`, field: name };
                }
                value = date.toISOString();
            }
            
            values.push(value);
            paramIndex++;
        }
    }
    
    const placeholders = values.map((_, i) => `$${i + 1}`).join(",");
    return {
        text: `INSERT INTO "${TABLE_NAME}" (${columns.join(",")}) VALUES (${placeholders}) RETURNING id, created_at`,
        values: values
    };
}

// Generate multer fields configuration
const uploadFields = Object.entries(schema)
    .filter(([_, field]) => field.type === "photo" || field.type === "file")
    .map(([name, _]) => ({ name, maxCount: 1 }));

// Main save endpoint
app.post("/api/save", upload.fields(uploadFields), async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query("BEGIN");
        
        const files = req.files || {};
        
        const validationError = validate(req.body, files);
        if (validationError) {
            await client.query("ROLLBACK");
            return res.status(400).json(validationError);
        }
        
        const query = buildInsertQuery(req.body, files);
        const result = await client.query(query.text, query.values);
        
        await client.query("COMMIT");
        
        console.log(`✅ Record saved to ${TABLE_NAME} with ID: ${result.rows[0]?.id}`);
        
        res.json({ 
            success: true, 
            id: result.rows[0]?.id,
            created_at: result.rows[0]?.created_at,
            message: "Record saved successfully",
            table: TABLE_NAME
        });
    } catch (error) {
        await client.query("ROLLBACK");
        
        console.error("❌ Save error:", error);
        
        // Handle specific database errors
        if (error.code === "23505") { // Unique violation
            return res.status(409).json({ 
                error: "Duplicate entry - this record already exists",
                code: "DUPLICATE_ENTRY",
                details: error.detail
            });
        } else if (error.code === "23502") { // Not null violation
            return res.status(400).json({ 
                error: "Missing required field",
                code: "MISSING_REQUIRED",
                field: error.column
            });
        } else if (error.code === "22P02") { // Invalid input syntax
            return res.status(400).json({ 
                error: "Invalid data format",
                code: "INVALID_FORMAT",
                details: error.message
            });
        } else if (error.error) { // Our custom validation errors
            return res.status(400).json(error);
        } else if (error.code === "22001") { // String data right truncation
            return res.status(400).json({
                error: "Data too long for field",
                code: "DATA_TOO_LONG"
            });
        } else if (error.code === "22003") { // Numeric value out of range
            return res.status(400).json({
                error: "Numeric value out of range",
                code: "NUMERIC_OUT_OF_RANGE"
            });
        }
        
        // Generic error
        res.status(500).json({ 
            error: "Internal server error",
            code: "INTERNAL_ERROR",
            message: error.message
        });
    } finally {
        client.release();
    }
});

// Additional endpoints
app.get("/schema", (_, res) => {
    res.json({ 
        table: TABLE_NAME,
        schema: schema,
        fields: Object.keys(schema).length,
        autoCreated: AUTO_CREATED_AT,
        timestamp: new Date().toISOString()
    });
});

app.get("/health", (_, res) => {
    res.json({ 
        status: "ok", 
        timestamp: new Date().toISOString(),
        service: "database-api",
        version: "1.0.0",
        uptime: process.uptime(),
        database: "connected"
    });
});

// Root route
app.get("/", (_, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
            <head>
                <title>Database API Server</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
                    h1 { color: #333; }
                    .endpoint { background: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 5px; }
                    .method { color: #007bff; font-weight: bold; }
                </style>
            </head>
            <body>
                <h1>🚀 Database API Server</h1>
                <p>API is running successfully!</p>
                
                <h2>Available Endpoints:</h2>
                <div class="endpoint">
                    <span class="method">POST</span> /api/save - Save a record
                </div>
                <div class="endpoint">
                    <span class="method">GET</span> /health - Health check
                </div>
                
                <h2>Service Information:</h2>
                <ul>
                    <li>Service: database-api</li>
                    <li>Version: 1.0.0</li>
                    <li>Table: ${TABLE_NAME}</li>
                </ul>
            </body>
        </html>
    `);
});

// Initialize database
(async () => {
    try {
        await pool.query(createTableSQL());
        console.log(`✅ Table '${TABLE_NAME}' created/verified successfully`);
        console.log(`📊 Table has ${Object.keys(schema).length} fields`);
        console.log(`📁 File upload fields: ${Object.entries(schema).filter(([_, f]) => f.type === 'photo' || f.type === 'file').length}`);
    } catch (error) {
        console.error("❌ Table creation error:", error);
        process.exit(1);
    }
})();

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔗 API Base URL: http://localhost:${PORT}`);
    console.log("📋 Endpoints available:");
    console.log("  POST /api/save    - Save a record with full validation");
    console.log("  GET  /schema      - Get schema information");
    console.log("  GET  /health      - Health check");
    console.log("📝 Validation includes:");
    console.log("  • Required fields");
    console.log("  • Unique constraints");
    console.log("  • Email/URL/Phone validation");
    console.log("  • File size and type limits");
    console.log("  • Numeric precision limits");
    console.log("  • Transaction support with rollback");
});