const express = require('express');
const multer = require('multer');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');  
const PDFDocument = require('pdfkit');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).send('API Key no encontrada en .env');
    }

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    let textoExtraido = '';

    if (ext === '.pdf') {
      const buffer = fs.readFileSync(filePath);
      const content = await pdfParse(buffer);
      textoExtraido = content.text;
    } else if (ext === '.docx') {
      const buffer = fs.readFileSync(filePath);
      const result = await mammoth.extractRawText({ buffer });
      textoExtraido = result.value;
    } else {
      return res.status(400).send('Solo se aceptan archivos PDF o DOCX');
    }

    const preguntas = extraerPreguntas(textoExtraido);
    if (preguntas.length === 0) {
      return res.status(400).send('No se encontraron preguntas en el archivo.');
    }

    const respuestas = await obtenerRespuestas(preguntas);

    const output = await generarPDF(preguntas, respuestas);
    res.download(output, 'respuestas.pdf');
  } catch (err) {
    console.error('Error general:', err);
    res.status(500).send('Ocurrió un error al procesar el archivo.');
  }
});

function extraerPreguntas(texto) {
  const resultados = new Set();

  const lineas = texto.split(/[\r\n]+/);

  for (let linea of lineas) {
    linea = linea.trim();
    if (linea.length < 5) continue; 

    const oraciones = linea.split(/(?<=[.?!])\s+/);
    for (let oracion of oraciones) {
      const limpia = oracion.trim();
      if (limpia.length >= 1) {
        resultados.add(limpia);
      }
    }
  }

  return Array.from(resultados);
}

// groq
async function obtenerRespuestas(preguntas) {
  const respuestas = [];

  for (const pregunta of preguntas) {
    try {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'deepseek-r1-distill-llama-70b',
          messages: [{ role: 'user', content: pregunta }],
          temperature: 0.5
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const respuesta = response.data?.choices?.[0]?.message?.content || 'Respuesta no disponible';
      respuestas.push(respuesta);
    } catch (err) {
      console.error(`Error con la pregunta "${pregunta}":`, err.response?.data?.error || err.message);
      respuestas.push('Error al generar respuesta');
    }
  }

  return respuestas;
}

// crear el pdf de respuestas
async function generarPDF(preguntas, respuestas) {
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  const outputPath = path.join(outputDir, `respuestas-${Date.now()}.pdf`);
  const doc = new PDFDocument();
  const writeStream = fs.createWriteStream(outputPath);
  doc.pipe(writeStream);

  preguntas.forEach((pregunta, i) => {
    doc.fontSize(14).text(`Pregunta: ${pregunta}`);
    doc.fontSize(12).text(`Respuesta: ${respuestas[i]}`);
    doc.moveDown();
  });

  doc.end();

  await new Promise((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  return outputPath;
}

app.listen(3000, () => {
  console.log('Servidor escuchando en http://localhost:3000');
});
