import express from 'express';
import path from 'path';
import fs from 'fs';
import { db } from '../../db.js'; // Adjust path to db.js if needed. src/routes/admin/ -> ../../db.js is correct.

const router = express.Router();

/**
 * @swagger
 * /api/attachment/{id}:
 *   get:
 *     summary: Get attachment file by ID
 *     tags: [Attachments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: The file stream
 *       404:
 *         description: Attachment/File not found
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query('SELECT path, name FROM attachment WHERE id = ?', [id]);

        if (!rows || rows.length === 0) {
            return res.status(404).json({ message: 'Attachment record not found' });
        }

        const { path: dbPath, name } = rows[0];
        let filePath;

        // Determine file path
        if (name) {
            // New format: path is directory (e.g. 'IMAGE/'), name is filename
            // We strip trailing slash if present to be safe, though join handles it
            filePath = path.resolve(process.cwd(), dbPath, name);
        } else {
            // Legacy format: path is full path
            if (path.isAbsolute(dbPath)) {
                filePath = dbPath;
            } else {
                filePath = path.resolve(process.cwd(), dbPath);
            }
        }

        // Verify file exists
        if (!fs.existsSync(filePath)) {
            console.error(`[Attachment] File missing at path: ${filePath}`);
            return res.status(404).json({ message: 'File not found on server disk' });
        }

        res.sendFile(filePath);

    } catch (error) {
        console.error('GET /attachment/:id ERROR:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

export default router;
