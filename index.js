// Importar módulos necesarios
const express = require('express');
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');

// Configurar dotenv para usar variables de entorno
dotenv.config();

// Inicializar Express
const app = express();
app.use(express.json());

// Configurar Firebase Admin con las credenciales
//const serviceAccount = require('./config/licenciasiet-firebase-adminsdk-lx2et-7b021ea963.json');
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS_JSON);



if (process.env.FIREBASE_CREDENTIALS_JSON) {
    try {
        const credentials = JSON.parse(process.env.FIREBASE_CREDENTIALS_JSON);
        console.log("Firebase credentials loaded successfully:", credentials);
    } catch (error) {
        console.error("Error parsing Firebase credentials JSON:", error);
    }
} else {
    console.error("FIREBASE_CREDENTIALS_JSON environment variable is not set.");
}




admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// Inicializar Firestore
const db = admin.firestore();

// Configurar el transporter de nodemailer para enviar correos
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Función para enviar un correo al administrador con la información de la licencia
async function enviarCorreoAdmin(licenciaData, ip) {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.ADMIN_EMAIL,
        subject: 'Acceso Denegado a Licencia',
        text: `Se intentó acceder a la licencia **${licenciaData.licencia}** desde una IP diferente: **${ip}**.\n\nDetalles de la licencia:\n- **Licencia:** ${licenciaData.licencia}\n- **Fecha de Expiración:** ${licenciaData.fechaExpiracion.toDate()}\n- **Última IP de Activación:** ${licenciaData.ipUltimaActivacion}\n\n**Histórico de IPs fallidas:**\n${(licenciaData.historicoIPFallida && licenciaData.historicoIPFallida.length > 0) ? licenciaData.historicoIPFallida.join('\n') : 'N/A'}`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Correo enviado al administrador con la información de la licencia.');
    } catch (error) {
        console.error('Error al enviar el correo al administrador:', error);
    }
}

// Ajustar la fecha y hora en el formato deseado
const ajustarFechaLocal = (fecha) => {
    const opciones = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' };
    return new Intl.DateTimeFormat('es-ES', opciones).format(fecha).replace(/\//g, '-').replace(',', '');
};

// Ruta básica de prueba
app.get('/', (req, res) => {
    res.send('API de Licencias en línea 2323');
});

app.post('/prueba', (req, res) => {
    res.json({ mensaje: "Ruta de prueba funcionando" });
});



// Ruta para verificar la licencia
app.post('/verificar-licencia', async (req, res) => {
    const { licencia, ip } = req.body;

    try {
        const licenciasRef = db.collection('LicenciasIET');
        const snapshot = await licenciasRef.where('licencia', '==', licencia).get();

        if (snapshot.empty) {
            return res.status(404).json({ mensaje: 'Licencia no encontrada.' });
        }

        const doc = snapshot.docs[0];
        const data = doc.data();

        // Verificar si la licencia está bloqueada
        if (data.bloqueado) {
            return res.status(403).json({ mensaje: 'Acceso denegado. La licencia está bloqueada.' });
        }

        const fechaExpiracion = data.fechaExpiracion.toDate();
        const fechaActual = new Date();

        // Verificar expiración y IP
        if (fechaActual > fechaExpiracion) {
            return res.status(403).json({ mensaje: 'Licencia expirada.' });
        }

        const ipUltimaActivacion = data.ipUltimaActivacion;
        const fechaUltimaActivacion = data.fechaUltimaActivacion.toDate();
        const diferenciaHoras = (fechaActual - fechaUltimaActivacion) / (1000 * 60 * 60);
        let numeroFallosIP = data.numeroFallosIP || 0;

        // Si la IP no coincide y la diferencia de horas es menor a 24
        if (ip !== ipUltimaActivacion) {
            // Solo incrementa el número de fallos si la diferencia de horas es menor a 24
            if (diferenciaHoras < 24) {
                // Crear el nuevo registro para el histórico
                const ultimaActivacionFormateada = ajustarFechaLocal(fechaUltimaActivacion);
                const intentoFormateado = ajustarFechaLocal(fechaActual);
                const nuevoRegistro = `Última IP activada: ${ipUltimaActivacion} | Fecha de última IP: ${ultimaActivacionFormateada} | IP del intento: ${ip} | Fecha del intento: ${intentoFormateado}`;

                // Actualizar el historial de IPs fallidas
                const historicoIPFallida = data.historicoIPFallida || [];
                if (historicoIPFallida.length < 50) {
                    historicoIPFallida.push(nuevoRegistro);
                } else {
                    historicoIPFallida.shift(); // Eliminar el primer elemento si ya tiene 50
                    historicoIPFallida.push(nuevoRegistro);
                }

                // Incrementar el contador de fallos de IP
                numeroFallosIP++;
                await licenciasRef.doc(doc.id).update({
                    numeroFallosIP,
                    historicoIPFallida,
                    bloqueado: true // Bloquear la licencia
                });

                // Enviar correo al administrador
                await enviarCorreoAdmin(data, ip);
                return res.status(403).json({ mensaje: 'Acceso denegado. IP diferente en menos de 24 horas. La licencia ha sido bloqueada.' });
            }
        }

        // Actualizar la fecha y la IP de última activación solo si la IP es diferente
        if (ip !== ipUltimaActivacion) {
            await licenciasRef.doc(doc.id).update({
                ipUltimaActivacion: ip,
                fechaUltimaActivacion: admin.firestore.Timestamp.fromDate(fechaActual)
            });
        }

        // Acceso permitido
        return res.status(200).json({ mensaje: 'Acceso permitido.' });
    } catch (error) {
        console.error('Error al verificar la licencia:', error);
        return res.status(500).json({ mensaje: 'Error interno del servidor.' });
    }
});

// Iniciar el servidor
//const PORT = process.env.PORT || 3000;
//app.listen(PORT, () => {
//    console.log(`Servidor corriendo en http://localhost:${PORT}`);
//});
module.exports = app;
