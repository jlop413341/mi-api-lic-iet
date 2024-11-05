const express = require('express');
const app = express();

app.use(express.json());

// Ruta básica de prueba
app.get('/', (req, res) => {
    res.send('API en línea');
});

// Ruta para verificar la licencia
app.post('/verificar-licencia', (req, res) => {
    const { licencia, ip } = req.body;
    res.json({
        mensaje: 'Verificación de licencia recibida',
        licencia: licencia,
        ip: ip
    });
});

module.exports = app;
