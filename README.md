# Medidor AR — MedSolution · Versión 2 (prototipo)

PWA de medición para teléfonos Android compatibles, preparada para pruebas en **Xiaomi 12 Pro**. Su inclusión en la lista oficial de ARCore no garantiza que todas las funciones WebXR estén habilitadas en el navegador del dispositivo, por eso la aplicación comprueba `immersive-ar` durante la ejecución.

## Funcionalidad incluida

**Objetos y espacios (WebXR / ARCore)**
- Medición de distancia entre 2 puntos, superficie y perímetro con 3 o más puntos 3D.
- Retícula de detección, segmentos, deshacer, guardar resultado, historial y exportación CSV.
- Requiere Chrome Android compatible, Google Play Services for AR, permisos de cámara y HTTPS.

**Medidas corporales (fotografía calibrada)**
- Fotografía con cámara o galería; se visualiza en un lienzo local, sin guardarse en historial.
- Calibración manual con referencia conocida **ubicada en el mismo plano físico** que el cuerpo (por ejemplo una regla de 30 cm colocada junto a la persona).
- Marcar dos puntos y calcular una longitud corporal orientativa en centímetros (estatura, hombros, anchura de cadera o segmentos).
- Detección opcional de 33 puntos de postura con MediaPipe Pose Landmarker en el navegador. Segmentos sugeridos: hombros, ancho de cadera, brazo izquierdo/derecho por codo y pierna izquierda/derecha por rodilla. La IA necesita descargar la librería y el modelo desde internet la primera vez; es opcional. No se deducen longitudes corporales en centímetros sin calibración real.
- Registro manual de perímetros reales con cinta métrica (cintura, tórax, cadera, brazo, muslo), estatura y otras medidas. **No se estiman perímetros automáticamente desde una fotografía 2D**.
- Historial corporal separado, código de referencia local opcional, eliminación y exportación CSV. Sin cuenta ni base de datos remota.

## Publicación y prueba en Xiaomi 12 Pro

1. Publicar todo el contenido de la carpeta en un hosting estático HTTPS (Cloudflare Pages, Vercel o similar). No se necesita servidor, login ni Supabase.
2. Abrir el enlace desde Chrome para Android en el Xiaomi 12 Pro; instalar/actualizar si procede **Servicios de Google Play para RA** y conceder acceso a la cámara.
3. En **Objetos**, comprobar el estado de compatibilidad e iniciar AR. Mover el móvil para reconocer superficies, marcar puntos y guardar.
4. En **Medidas corporales**, tomar foto (preferiblemente con ayuda de otra persona), incluir una referencia de tamaño conocido en el mismo plano que la zona de medida, pulsar «Calibrar escala» y marcar los extremos de la referencia. Después pulsar «Medir segmento» y marcar sus extremos. O detectar postura con IA, escoger un segmento y usar sus puntos antes de guardar.
5. Para **perímetros**, medir con cinta y guardar el valor en «Registrar perímetros».
6. En Chrome usar **Instalar aplicación / Añadir a pantalla de inicio** para instalar la PWA.

**No abrir con `file://`** para probar la PWA: cámaras AR requieren HTTPS o `localhost` (desarrollo). Se puede ejecutar `python3 -m http.server 8000` localmente desde la carpeta, y abrir `http://localhost:8000` en el mismo equipo, pero no sirve como prueba de AR Android.

## Privacidad y limitaciones

- El código no envía fotos corporales a servidores: MediaPipe descarga *código/modelo* desde CDN de jsDelivr y Google Storage, y procesa la imagen localmente. La imagen seleccionada no se conserva al cerrar/recargar la página. Los resultados numéricos sí se guardan en el navegador.
- La API WebXR depende de la superficie detectada. ARCore admite la API de profundidad en Xiaomi 12 Pro, pero **no equivale a un escáner 3D de precisión certificada**.
- Una medición en píxeles calibrada con un solo objeto puede verse afectada por perspectiva, postura y diferentes planos de profundidad; no debe usarse para decisiones médicas, diagnóstico, dosificación o confección de precisión sin comparación con un instrumento físico.
- La detección de 33 puntos corporales **no determina por sí sola la estatura real ni los perímetros**. Las distancias segmentales se proyectan sobre la imagen y son orientativas.
- Recursos básicos de la PWA quedan en caché. La carga inicial de MediaPipe requiere internet y su disponibilidad offline posterior no está garantizada. La funcionalidad manual y los datos locales pueden funcionar offline tras la instalación.
- La información local puede perderse si se borran datos del navegador; utiliza la exportación CSV como respaldo. No guardar nombres, historias clínicas ni identificadores personales en el campo de referencia.
- No se ha validado AR con el Xiaomi 12 Pro físico; eso requiere una prueba del usuario en Chrome y verificar precisión frente a un metro/cinta.

## Archivos

- `index.html`: interfaz con módulos Objetos y Cuerpo.
- `styles.css`: estilos adaptables a teléfonos.
- `app.js`: lógica WebXR para objetos.
- `body.js`: cámara/foto calibrada, detector opcional de postura, mediciones corporales, historial y exportación.
- `service-worker.js`, `manifest.webmanifest`, `icons/*`: instalación y caché de PWA.

## Referencias técnicas

- Lista oficial ARCore: https://developers.google.com/ar/devices
- Requisitos WebXR: https://developers.google.com/ar/develop/webxr/requirements
- Google MediaPipe Pose Landmarker: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker