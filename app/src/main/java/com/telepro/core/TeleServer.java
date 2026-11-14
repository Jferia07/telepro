package com.telepro.core;

import java.io.BufferedInputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Servidor local de TelePro. Java puro (sin dependencias de Android):
 * sirve la interfaz, guarda los guiones y conecta la tableta con los controles remotos por Wi-Fi.
 */
public class TeleServer {

    /** Origen de los archivos de la interfaz (assets en Android, carpeta en pruebas). */
    public interface Assets {
        InputStream open(String path) throws IOException;
    }

    private static final int MAX_BODY = 60 * 1024 * 1024;

    private final Assets assets;
    private final File dataDir;
    private final CopyOnWriteArrayList<Client> clients = new CopyOnWriteArrayList<Client>();
    private final ExecutorService pool;
    private ServerSocket serverSocket;
    private volatile boolean running;
    private volatile String lastState;
    private int port;
    private String pin;

    private static class Client {
        final String id;
        final String role;
        final LinkedBlockingQueue<String> queue = new LinkedBlockingQueue<String>();

        Client(String id, String role) {
            this.id = id;
            this.role = role;
        }
    }

    private static class Request {
        String method;
        String path;
        Map<String, String> query = new HashMap<String, String>();
        Map<String, String> headers = new HashMap<String, String>();
        byte[] body = new byte[0];
        boolean loopback;
    }

    public TeleServer(Assets assets, File dataDir) {
        this.assets = assets;
        this.dataDir = dataDir;
        this.pool = Executors.newCachedThreadPool(new ThreadFactory() {
            @Override
            public Thread newThread(Runnable r) {
                Thread t = new Thread(r, "telepro-http");
                t.setDaemon(true);
                return t;
            }
        });
    }

    public int getPort() {
        return port;
    }

    public String getPin() {
        return pin;
    }

    /** Inicia el servidor; prueba el puerto preferido y los 20 siguientes. */
    public synchronized int start(int preferredPort) throws IOException {
        if (running) return port;
        if (!dataDir.exists() && !dataDir.mkdirs()) {
            throw new IOException("No se pudo crear la carpeta de datos");
        }
        pin = loadOrCreatePin();
        IOException last = null;
        for (int p = preferredPort; p < preferredPort + 20; p++) {
            try {
                ServerSocket ss = new ServerSocket();
                ss.setReuseAddress(true);
                ss.bind(new java.net.InetSocketAddress(p));
                serverSocket = ss;
                port = p;
                last = null;
                break;
            } catch (IOException e) {
                last = e;
            }
        }
        if (last != null) throw last;
        running = true;
        Thread acceptor = new Thread(new Runnable() {
            @Override
            public void run() {
                acceptLoop();
            }
        }, "telepro-accept");
        acceptor.setDaemon(true);
        acceptor.start();
        return port;
    }

    public synchronized void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket s = serverSocket.accept();
                pool.execute(new Runnable() {
                    @Override
                    public void run() {
                        handle(s);
                    }
                });
            } catch (IOException e) {
                if (!running) return;
            }
        }
    }

    private String loadOrCreatePin() throws IOException {
        File f = new File(dataDir, "_pin.txt");
        if (f.exists()) {
            String s = new String(readFile(f), StandardCharsets.UTF_8).trim();
            if (s.matches("[0-9]{6}")) return s;
        }
        String p = String.format(Locale.US, "%06d", new SecureRandom().nextInt(1000000));
        writeFile(f, p.getBytes(StandardCharsets.UTF_8));
        return p;
    }

    // ------------------------------------------------------------------ HTTP

    private void handle(Socket s) {
        try {
            s.setTcpNoDelay(true);
            s.setSoTimeout(30000);
            InputStream in = new BufferedInputStream(s.getInputStream());
            OutputStream out = s.getOutputStream();
            Request rq = readRequest(in);
            if (rq == null) {
                return;
            }
            InetAddress addr = s.getInetAddress();
            rq.loopback = addr != null && addr.isLoopbackAddress();
            route(rq, s, out);
        } catch (Exception ignored) {
        } finally {
            try {
                s.close();
            } catch (IOException ignored) {
            }
        }
    }

    private Request readRequest(InputStream in) throws IOException {
        ByteArrayOutputStream head = new ByteArrayOutputStream();
        int state = 0;
        while (state < 4) {
            int b = in.read();
            if (b < 0) return null;
            head.write(b);
            if (head.size() > 32768) return null;
            if (b == '\r' && (state == 0 || state == 2)) state++;
            else if (b == '\n' && (state == 1 || state == 3)) state++;
            else state = 0;
        }
        String[] lines = new String(head.toByteArray(), StandardCharsets.ISO_8859_1).split("\r\n");
        if (lines.length == 0) return null;
        String[] first = lines[0].split(" ");
        if (first.length < 2) return null;
        Request rq = new Request();
        rq.method = first[0].toUpperCase(Locale.US);
        String target = first[1];
        int q = target.indexOf('?');
        String rawPath = q >= 0 ? target.substring(0, q) : target;
        rq.path = decode(rawPath);
        if (q >= 0) {
            String[] pairs = target.substring(q + 1).split("&");
            for (int i = 0; i < pairs.length; i++) {
                String pair = pairs[i];
                int eq = pair.indexOf('=');
                if (eq > 0) rq.query.put(decode(pair.substring(0, eq)), decode(pair.substring(eq + 1)));
            }
        }
        for (int i = 1; i < lines.length; i++) {
            int c = lines[i].indexOf(':');
            if (c > 0) {
                rq.headers.put(lines[i].substring(0, c).trim().toLowerCase(Locale.US), lines[i].substring(c + 1).trim());
            }
        }
        int len = 0;
        String cl = rq.headers.get("content-length");
        if (cl != null) {
            try {
                len = Integer.parseInt(cl);
            } catch (NumberFormatException e) {
                len = 0;
            }
        }
        if (len < 0 || len > MAX_BODY) return null;
        if (len > 0) {
            byte[] body = new byte[len];
            int off = 0;
            while (off < len) {
                int n = in.read(body, off, len - off);
                if (n < 0) return null;
                off += n;
            }
            rq.body = body;
        }
        return rq;
    }

    private static String decode(String s) {
        try {
            return URLDecoder.decode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    private boolean authorized(Request rq) {
        if (rq.loopback) return true;
        String k = rq.query.get("k");
        return k != null && k.equals(pin);
    }

    private void route(Request rq, Socket s, OutputStream out) throws IOException {
        String p = rq.path;
        if (p.startsWith("/api/")) {
            if (!authorized(rq)) {
                sendText(out, 403, "text/plain; charset=utf-8", "PIN incorrecto");
                return;
            }
            if (p.equals("/api/info")) {
                sendText(out, 200, "application/json; charset=utf-8", infoJson(rq.loopback));
            } else if (p.equals("/api/events")) {
                serveEvents(rq, s, out);
            } else if (p.equals("/api/send") && rq.method.equals("POST")) {
                String msg = new String(rq.body, StandardCharsets.UTF_8).replace('\n', ' ').replace('\r', ' ');
                if ("state".equals(rq.query.get("kind"))) lastState = msg;
                broadcast(msg, rq.query.get("id"));
                sendText(out, 200, "text/plain; charset=utf-8", "ok");
            } else if (p.equals("/api/kv")) {
                serveKv(rq, out);
            } else if (p.equals("/api/kv/delete") && rq.method.equals("POST")) {
                File f = kvFile(rq.query.get("key"));
                if (f != null && f.exists()) f.delete();
                sendText(out, 200, "text/plain; charset=utf-8", "ok");
            } else if (p.equals("/api/docx") && rq.method.equals("POST")) {
                try {
                    sendText(out, 200, "text/plain; charset=utf-8", extractDocx(rq.body));
                } catch (Exception e) {
                    sendText(out, 422, "text/plain; charset=utf-8", "No se pudo leer el documento de Word");
                }
            } else {
                sendText(out, 404, "text/plain; charset=utf-8", "No existe");
            }
            return;
        }
        serveStatic(p, out);
    }

    private String infoJson(boolean loopback) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"port\":").append(port).append(",\"ips\":[");
        List<String> ips = localAddresses();
        for (int i = 0; i < ips.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append('"').append(ips.get(i)).append('"');
        }
        sb.append("],\"peers\":").append(peerCount());
        if (loopback) sb.append(",\"pin\":\"").append(pin).append('"');
        sb.append('}');
        return sb.toString();
    }

    /** Direcciones IPv4 locales (Wi-Fi o zona portátil) por las que se puede llegar a la tableta. */
    public static List<String> localAddresses() {
        List<String> out = new ArrayList<String>();
        try {
            Enumeration<NetworkInterface> en = NetworkInterface.getNetworkInterfaces();
            while (en != null && en.hasMoreElements()) {
                NetworkInterface ni = en.nextElement();
                try {
                    if (!ni.isUp() || ni.isLoopback()) continue;
                } catch (Exception e) {
                    continue;
                }
                Enumeration<InetAddress> ads = ni.getInetAddresses();
                while (ads.hasMoreElements()) {
                    InetAddress a = ads.nextElement();
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) {
                        String h = a.getHostAddress();
                        if (h != null && !out.contains(h)) out.add(h);
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    // ------------------------------------------------------------- eventos

    private int peerCount() {
        int n = 0;
        for (Client c : clients) {
            if (!"display".equals(c.role)) n++;
        }
        return n;
    }

    private void broadcast(String msg, String exceptId) {
        for (Client c : clients) {
            if (exceptId != null && exceptId.equals(c.id)) continue;
            if (c.queue.size() < 500) c.queue.offer(msg);
        }
    }

    private void broadcastPeers() {
        broadcast("{\"t\":\"peers\",\"n\":" + peerCount() + "}", null);
    }

    private void serveEvents(Request rq, Socket s, OutputStream out) throws IOException {
        String id = rq.query.get("id");
        String role = rq.query.get("role");
        Client c = new Client(id == null ? "anon" : id, role == null ? "remote" : role);
        s.setSoTimeout(0);
        String head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\n"
                + "Cache-Control: no-cache, no-store\r\nConnection: keep-alive\r\nX-Accel-Buffering: no\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write("retry: 1500\n\n".getBytes(StandardCharsets.UTF_8));
        String st = lastState;
        if (st != null && !"display".equals(c.role)) {
            out.write(("data: " + st + "\n\n").getBytes(StandardCharsets.UTF_8));
        }
        out.flush();
        clients.add(c);
        broadcastPeers();
        try {
            while (running) {
                String msg = c.queue.poll(10, TimeUnit.SECONDS);
                if (msg == null) {
                    out.write(": ping\n\n".getBytes(StandardCharsets.UTF_8));
                } else {
                    out.write(("data: " + msg + "\n\n").getBytes(StandardCharsets.UTF_8));
                }
                out.flush();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (IOException e) {
            // el cliente se desconectó
        } finally {
            clients.remove(c);
            broadcastPeers();
        }
    }

    // ------------------------------------------------------- almacenamiento

    private File kvFile(String key) {
        if (key == null || !key.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,63}")) return null;
        return new File(dataDir, key + ".json");
    }

    private void serveKv(Request rq, OutputStream out) throws IOException {
        File f = kvFile(rq.query.get("key"));
        if (f == null) {
            sendText(out, 400, "text/plain; charset=utf-8", "Clave no válida");
            return;
        }
        if (rq.method.equals("POST")) {
            synchronized (this) {
                writeFile(f, rq.body);
            }
            sendText(out, 200, "text/plain; charset=utf-8", "ok");
        } else if (f.exists()) {
            send(out, 200, "application/json; charset=utf-8", readFile(f));
        } else {
            sendText(out, 404, "text/plain; charset=utf-8", "");
        }
    }

    private static byte[] readFile(File f) throws IOException {
        FileInputStream in = new FileInputStream(f);
        try {
            return readAll(in);
        } finally {
            in.close();
        }
    }

    private static void writeFile(File f, byte[] data) throws IOException {
        File tmp = new File(f.getParentFile(), f.getName() + ".tmp");
        FileOutputStream o = new FileOutputStream(tmp);
        try {
            o.write(data);
            o.flush();
        } finally {
            o.close();
        }
        if (f.exists() && !f.delete()) throw new IOException("No se pudo reemplazar " + f.getName());
        if (!tmp.renameTo(f)) throw new IOException("No se pudo guardar " + f.getName());
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        return bo.toByteArray();
    }

    // ------------------------------------------------------------ estáticos

    private void serveStatic(String path, OutputStream out) throws IOException {
        if (path.equals("/")) path = "/index.html";
        if (path.contains("..") || path.contains("\\")) {
            sendText(out, 400, "text/plain; charset=utf-8", "Ruta no válida");
            return;
        }
        byte[] data;
        try {
            InputStream in = assets.open(path.substring(1));
            try {
                data = readAll(in);
            } finally {
                in.close();
            }
        } catch (IOException e) {
            sendText(out, 404, "text/plain; charset=utf-8", "No existe");
            return;
        }
        send(out, 200, mime(path), data);
    }

    private static String mime(String p) {
        String l = p.toLowerCase(Locale.US);
        if (l.endsWith(".html")) return "text/html; charset=utf-8";
        if (l.endsWith(".js") || l.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (l.endsWith(".css")) return "text/css; charset=utf-8";
        if (l.endsWith(".svg")) return "image/svg+xml";
        if (l.endsWith(".json")) return "application/json; charset=utf-8";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }

    private static void sendText(OutputStream out, int status, String type, String text) throws IOException {
        send(out, status, type, text.getBytes(StandardCharsets.UTF_8));
    }

    private static void send(OutputStream out, int status, String type, byte[] body) throws IOException {
        String reason = status == 200 ? "OK" : status == 404 ? "Not Found" : status == 403 ? "Forbidden" : "Error";
        String head = "HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.length
                + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    // ----------------------------------------------------------------- Word

    /** Extrae el texto de un archivo .docx (párrafos, saltos de línea y tabulaciones). */
    public static String extractDocx(byte[] data) throws IOException {
        ZipInputStream zin = new ZipInputStream(new ByteArrayInputStream(data));
        String xml = null;
        try {
            ZipEntry e;
            while ((e = zin.getNextEntry()) != null) {
                if ("word/document.xml".equals(e.getName())) {
                    xml = new String(readAll(zin), StandardCharsets.UTF_8);
                    break;
                }
            }
        } finally {
            zin.close();
        }
        if (xml == null) throw new IOException("No es un documento de Word (.docx)");
        StringBuilder sb = new StringBuilder();
        int i = 0;
        int n = xml.length();
        while (i < n) {
            int lt = xml.indexOf('<', i);
            if (lt < 0) break;
            int gt = xml.indexOf('>', lt);
            if (gt < 0) break;
            int e = lt + 1;
            while (e < gt && xml.charAt(e) != ' ' && xml.charAt(e) != '/' || e == lt + 1 && xml.charAt(e) == '/') e++;
            String name = xml.substring(lt + 1, e);
            boolean selfClosing = xml.charAt(gt - 1) == '/';
            i = gt + 1;
            if (name.equals("w:t") && !selfClosing) {
                int end = xml.indexOf("</w:t>", i);
                if (end < 0) break;
                sb.append(unescape(xml.substring(i, end)));
                i = end + 6;
            } else if (name.equals("/w:p") || name.equals("w:br") || name.equals("w:cr")) {
                sb.append('\n');
            } else if (name.equals("w:tab")) {
                sb.append('\t');
            }
        }
        return sb.toString().replaceAll("\n{3,}", "\n\n").trim();
    }

    private static String unescape(String s) {
        if (s.indexOf('&') < 0) return s;
        return s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&");
    }

    // --------------------------------------------------------------- pruebas

    /** Modo de escritorio para pruebas: java com.telepro.core.TeleServer carpetaWeb carpetaDatos puerto */
    public static void main(String[] args) throws Exception {
        final File web = new File(args[0]);
        TeleServer s = new TeleServer(new Assets() {
            @Override
            public InputStream open(String path) throws IOException {
                return new FileInputStream(new File(web, path));
            }
        }, new File(args[1]));
        int p = s.start(Integer.parseInt(args[2]));
        System.out.println("TelePro en http://127.0.0.1:" + p + "  PIN " + s.getPin());
        Thread.sleep(Long.MAX_VALUE);
    }
}
