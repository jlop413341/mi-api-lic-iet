// Importar módulos necesarios
const express = require('express');
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const MAX_IPS = 50; // Máximo de IPs a almacenar
const LICENCIA_PERMITIDA = process.env.LICENCIA_PERMITIDA; // Cambia esto por tu licencia válida desde el entorno

// Configurar dotenv para usar variables de entorno
dotenv.config();

// Inicializar Express
const app = express();
app.use(express.json());

// Configurar Firebase Admin con las credenciales separadas
const serviceAccount = {
    type: 'service_account',
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Reemplazar \n por saltos de línea
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
};

// Inicia Firebase solo si las credenciales fueron cargadas correctamente
if (serviceAccount) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
    console.log("Firebase credentials loaded successfully.");
} else {
    console.error("Failed to initialize Firebase Admin SDK due to missing credentials.");
}

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

// Ajustar la fecha y hora en el formato deseado
const ajustarFechaLocal = (fecha) => {
    const opciones = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' };
    return new Intl.DateTimeFormat('es-ES', opciones).format(fecha).replace(/\//g, '-').replace(',', '');
};

// Función para enviar un correo al administrador con la información de la licencia
async function enviarCorreoAdmin(licenciaData, ip, software) {
    const fechaExpiracion = ajustarFechaLocal(licenciaData.fechaExpiracion.toDate());
    const fechaUltimaActivacion = ajustarFechaLocal(licenciaData.fechaUltimaActivacion.toDate());
    const fechaBloqueo = licenciaData.fechaBloqueo ? ajustarFechaLocal(licenciaData.fechaBloqueo.toDate()) : 'N/A';

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.ADMIN_EMAIL,
        subject: 'Acceso Denegado a Licencia por Conflicto de IP',
        text: `Se intentó acceder a la licencia **${licenciaData.licencia}** desde una IP diferente: **${ip}**.\n\nDetalles de la licencia:\n` +
              `- **Licencia:** ${licenciaData.licencia}\n` +
              `- **Software Solicitado:** ${software || "No especificado"}\n` + 
              `- **Acceso Permitido a Software:** ${licenciaData.accesoSoftware.join(', ')}\n` +
              `- **Fecha de Expiración:** ${fechaExpiracion}\n` +
              `- **Última IP de Activación:** ${licenciaData.ipUltimaActivacion}\n` +
              `- **Fecha Última Activación:** ${fechaUltimaActivacion}\n` +
              `- **Fecha de Bloqueo (si aplica):** ${fechaBloqueo}\n` +
              `- **Número de Fallos IP:** ${licenciaData.numeroFallosIP}\n` +
              `- **IPs Autorizadas:**\n${licenciaData.IPs.length > 0 ? licenciaData.IPs.join('\n') : 'N/A'}\n` +
              `- **Histórico de IPs Fallidas:**\n${licenciaData.historicoIPFallida.length > 0 ? licenciaData.historicoIPFallida.join('\n') : 'N/A'}`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Correo enviado al administrador con la información de la licencia.');
    } catch (error) {
        console.error('Error al enviar el correo al administrador:', error);
    }
}





// Función para generar una cadena aleatoria alfanumérica de una longitud dada
function generarLicenciaAleatoria(longitud) {
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let licenciaGenerada = '';
    for (let i = 0; i < longitud; i++) {
        const indiceAleatorio = Math.floor(Math.random() * caracteres.length);
        licenciaGenerada += caracteres.charAt(indiceAleatorio);
    }
    return licenciaGenerada;
}

// Ruta para crear una nueva licencia con el nombre del documento como parámetro
// Ruta para crear una nueva licencia con el nombre del documento como parámetro
app.post('/crear-licencia/:documentName', async (req, res) => {
    const { documentName } = req.params; // Extraer el nombre del documento de los parámetros de la URL
    const { numeroMeses } = req.body; // Extrae el número de meses del cuerpo de la solicitud

    // Verificar si el número de meses es un número válido
    if (typeof numeroMeses !== 'number' || numeroMeses <= 0) {
        return res.status(400).json({ mensaje: 'Número de meses inválido. Debe ser un número positivo.' });
    }

    // Verificar si la licencia proporcionada es la permitida
    const licencia = req.body.licencia; // Asegúrate de que esto venga del cuerpo de la solicitud
    if (licencia !== LICENCIA_PERMITIDA) {
        return res.status(403).json({ mensaje: 'Acceso denegado. Licencia no válida.' });
    }

    try {
        // Comprobar si el documento ya existe
        const docRef = db.collection('LicenciasIET').doc(documentName);
        const doc = await docRef.get();

        if (doc.exists) {
            return res.status(409).json({ mensaje: 'El documento ya existe. No se ha realizado ninguna acción.' });
        }

        // Generar una nueva licencia aleatoria de 20 caracteres
        const nuevaLicenciaGenerada = generarLicenciaAleatoria(20);

        // Calcular la fecha de expiración sumando los meses actuales
        const fechaActual = new Date();
        const fechaExpiracion = new Date(fechaActual.setMonth(fechaActual.getMonth() + numeroMeses));

        // Crea el nuevo documento en la colección 'LicenciasIET' con el nombre proporcionado
        const nuevaLicencia = {
            fechaExpiracion: admin.firestore.Timestamp.fromDate(fechaExpiracion), // Asignar la nueva fecha de expiración
            fechaUltimaActivacion: admin.firestore.Timestamp.fromDate(new Date('2001-01-01T00:00:00Z')),
            ipUltimaActivacion: "",
            licencia: nuevaLicenciaGenerada, // Asignar la nueva licencia generada
            numeroFallosIP: 0,
            IPs: [],
            historicoIPFallida: [],
            fechaBloqueo: null, // Campo para la fecha de bloqueo inicializado como null

            // Añadir el campo accesoSoftware con los valores predeterminados
            accesoSoftware: ["KitOperador", "GestorSGX", "TRMax"]
        };

        await docRef.set(nuevaLicencia); // Usar 'set' para crear el documento con el nombre específico

        return res.status(201).json({ mensaje: 'Licencia creada exitosamente.', licenciaGenerada: nuevaLicenciaGenerada });
    } catch (error) {
        console.error('Error al crear la licencia:', error);
        return res.status(500).json({ mensaje: 'Error interno del servidor.' });
    }
});


// Ruta para verificar la licencia
// Ruta para verificar la licencia y el acceso al software
app.post('/verificar-licencia', async (req, res) => {
    const { licencia, software } = req.body; // Obtener la licencia y el software del cuerpo de la solicitud
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress; // Capturar la IP del cliente

    try {
        const licenciasRef = db.collection('LicenciasIET');
        const snapshot = await licenciasRef.where('licencia', '==', licencia).get();

        if (snapshot.empty) {
            return res.status(404).json({ mensaje: 'Licencia no encontrada.' });
        }

        const doc = snapshot.docs[0];
        const data = doc.data();

        // Verificar si el software está en el array accesoSoftware
        if (!data.accesoSoftware || !data.accesoSoftware.includes(software)) {
            return res.status(403).json({ mensaje: 'Acceso denegado para este software.' });
        }

        // Verificar si la licencia está bloqueada
        const fechaBloqueo = data.fechaBloqueo ? data.fechaBloqueo.toDate() : null;
        const fechaActual = new Date();

        if (fechaBloqueo && fechaActual < fechaBloqueo) {
            return res.status(403).json({ mensaje: 'Licencia bloqueada hasta: ' + fechaBloqueo });
        }

        const fechaExpiracion = data.fechaExpiracion.toDate();

        // Verificar expiración de la licencia
        if (fechaActual > fechaExpiracion) {
            return res.status(403).json({ mensaje: 'Licencia expirada.' });
        }

        const ipUltimaActivacion = data.ipUltimaActivacion;
        const fechaUltimaActivacion = data.fechaUltimaActivacion.toDate();
        const diferenciaHoras = (fechaActual - fechaUltimaActivacion) / (1000 * 60 * 60);
        let numeroFallosIP = data.numeroFallosIP || 0;

        // Verificar si la IP es diferente y la diferencia de tiempo es menor a 24 horas
        // Verificar si la IP es diferente y la diferencia de tiempo es menor a 24 horas
        if (ip !== ipUltimaActivacion) {
            if (diferenciaHoras < 24) {
                if (!fechaBloqueo || fechaActual >= fechaBloqueo) {
                    const ultimaActivacionFormateada = ajustarFechaLocal(fechaUltimaActivacion);
                    const intentoFormateado = ajustarFechaLocal(fechaActual);
                    const nuevoRegistro = `Última IP activada: ${ipUltimaActivacion} | Fecha de última IP: ${ultimaActivacionFormateada} | IP del intento: ${ip} | Fecha del intento: ${intentoFormateado}`;
        
                    const historicoIPFallida = data.historicoIPFallida || [];
                    if (historicoIPFallida.length < MAX_IPS) {
                        historicoIPFallida.push(nuevoRegistro);
                    } else {
                        historicoIPFallida.shift();
                        historicoIPFallida.push(nuevoRegistro);
                    }
        
                    numeroFallosIP++;
                    const diasBloqueo = Math.min(numeroFallosIP, 7);
                    const nuevaFechaBloqueo = admin.firestore.Timestamp.fromDate(new Date(Date.now() + diasBloqueo * 24 * 60 * 60 * 1000));
                    
                    // Actualizar los datos en la base de datos
                    await licenciasRef.doc(doc.id).update({
                        numeroFallosIP,
                        historicoIPFallida,
                        fechaBloqueo: nuevaFechaBloqueo
                    });
        
                    // Llamar a enviarCorreoAdmin después de actualizar la base de datos
                    data.fechaBloqueo = nuevaFechaBloqueo; // Actualizar la fecha en data antes de enviar el correo
                    await enviarCorreoAdmin(data, ip, software);
                }
                return res.status(403).json({ mensaje: 'Acceso denegado. IP diferente en menos de 24 horas.' });
            }
        }


        // Actualizar la última IP y la fecha de activación si es diferente
        if (ip !== ipUltimaActivacion) {
            await licenciasRef.doc(doc.id).update({
                ipUltimaActivacion: ip,
                fechaUltimaActivacion: admin.firestore.Timestamp.fromDate(fechaActual)
            });
        }

        // Agregar IP al historial de accesos si es diferente de la última IP
        const historicoIPs = data.IPs || [];
        if (historicoIPs.length === 0 || historicoIPs[historicoIPs.length - 1] !== ip) {
            if (historicoIPs.length >= MAX_IPS) {
                historicoIPs.shift();
            }
            historicoIPs.push(ip);
            await licenciasRef.doc(doc.id).update({
                IPs: historicoIPs
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
