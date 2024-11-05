// Importa Express
const express = require('express');
const app = express();

// Ruta básica de prueba
app.get('/', (req, res) => {
    res.send('API en línea');
});

// Exporta `app` para que Vercel lo maneje sin `app.listen`
module.exports = app;
