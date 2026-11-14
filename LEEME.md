# TelePro — teleprompter para tableta Android

App de teleprompter con modo espejo, editor de guiones, importación de PDF / Word / TXT,
mando Bluetooth, control remoto por Wi‑Fi (Android, iPhone, Mac) y segunda pantalla.

## 1. Obtener el archivo instalable (APK) — sin instalar nada en tu computador

Solo se hace una vez (unos 10 minutos). GitHub compila la app por ti, gratis.

1. Entra a https://github.com y crea una cuenta (o inicia sesión).
2. Arriba a la derecha pulsa **+ → New repository**. Nombre: `telepro`. Marca **Public**. Pulsa **Create repository**.
3. En la página que aparece, pulsa el enlace **uploading an existing file**.
4. En tu Mac abre la carpeta `TelePro` (la que sale al descomprimir el ZIP) y pulsa **Cmd + Shift + .** (punto)
   para ver los archivos ocultos: debe aparecer una carpeta llamada `.github`.
5. Selecciona **todo lo que hay dentro** de la carpeta TelePro (Cmd + A) y arrástralo a la página de GitHub (usa Chrome).
   Espera a que termine de subir y pulsa **Commit changes**.
6. Abre la pestaña **Actions**. Verás «Compilar APK» trabajando (círculo amarillo). Tarda de 3 a 5 minutos hasta el visto verde.
7. Vuelve a la página principal del repositorio; a la derecha, en **Releases**, entra y verás **TelePro.apk**.

Si en el paso 6 aparece una X roja, ábrela, copia el texto del error y envíaselo a Claude.

## 2. Instalar en la tableta

1. En la tableta abre Chrome y entra a `github.com/TU-USUARIO/telepro/releases`.
2. Toca **TelePro.apk** para descargarlo y luego ábrelo.
3. Android pedirá permiso para «instalar apps desconocidas» desde Chrome: actívalo y pulsa **Instalar**.

## 3. Uso rápido

- **Biblioteca:** crea un guion nuevo, importa un PDF / Word (.docx) / TXT, o pega texto copiado.
- **Editor:** pantalla grande para escribir; se guarda solo. `[Texto entre corchetes]` se muestra como nota resaltada.
- **Presentar:** toca la pantalla para iniciar o pausar; arrastra para mover el texto.
  Abajo: velocidad, tamaño, **Espejo** y voltear vertical. El botón de ajustes abre márgenes, interlineado,
  colores, tipo de letra, guía de lectura, cuenta regresiva y repetición.
- **Mando Bluetooth:** emparéjalo en Ajustes → Bluetooth de la tableta. Funciona de inmediato con los botones habituales
  (Enter/Play = iniciar o pausar, volumen o flechas arriba/abajo = velocidad, izquierda/derecha = retroceder/avanzar).
  Para cambiar un botón: Ajustes → Mando Bluetooth → **Asignar** y pulsa el botón del mando.
- **Control desde el celular o la Mac:** toca **Control remoto**, escanea el QR con la cámara del celular
  (Android o iPhone) y se abre el control en el navegador. Ambos equipos deben estar en el mismo Wi‑Fi,
  o la tableta conectada a la zona Wi‑Fi del celular; no hace falta internet. En la Mac escribe la dirección
  que aparece y el PIN; ahí además funcionan las teclas (espacio, flechas).
  Desde el control también puedes crear, importar y editar guiones con el teclado del computador.
- **Segunda pantalla:** en cualquier TV, monitor u otro dispositivo con navegador, abre la misma dirección y entra
  a la pestaña **Pantalla**: muestra el texto sincronizado con la tableta. Para TVs sin navegador usa la función
  «Transmitir / Smart View» de la tableta.

## Alternativa: compilar con Android Studio

Instala Android Studio, elige **Open** y selecciona la carpeta TelePro. Cuando termine de sincronizar:
**Build → Generate App Bundles or APKs → Generate APKs**. El archivo queda en `app/build/outputs/apk/debug/`.
