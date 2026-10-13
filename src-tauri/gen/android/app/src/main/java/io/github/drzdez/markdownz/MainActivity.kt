package io.github.drzdez.markdownz

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintJob
import android.print.PrintManager
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.content.FileProvider
import androidx.core.content.IntentCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.MessageDigest

/**
 * Markdownz on Android.
 *
 * Documents arrive as `content://` URIs (a file manager, the share sheet, the
 * document picker) which the Rust side cannot read directly. Every document is
 * therefore copied into the app's private storage, under `files/docs/<hash of the
 * URI>/<file name>`, next to a `.source` note that remembers where it came from.
 * The web view then works with that copy exactly like with a file on the desktop:
 * paths stay paths, tabs, history and the recent list need no special cases.
 *
 * `MarkdownzAndroid` is the JavaScript interface used by `src/backend.ts`.
 */
class MainActivity : TauriActivity() {
    private var webView: WebView? = null

    /** Documents handed over by intents or the picker that the page has not fetched yet. */
    private val pending = ArrayList<Pair<Uri, String?>>()
    private var printJob: PrintJob? = null

    private val docsDir: File
        get() = File(filesDir, "docs")

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Keep the page out from under the status bar, the navigation bar and the keyboard.
        val content = findViewById<View>(android.R.id.content)
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        queueIntent(intent)
        // Back closes a dialog or goes back in the tab's history; with nowhere to go the app closes.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val view = webView
                if (view == null) {
                    finish()
                    return
                }
                view.evaluateJavascript("window.mdzBack ? window.mdzBack() : false") { result ->
                    if (result != "true") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (queueIntent(intent)) notifyPage()
    }

    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        this.webView = webView
        webView.addJavascriptInterface(Bridge(), "MarkdownzAndroid")
    }

    /** Remembers the document of a VIEW or SEND intent; true when there was one. */
    private fun queueIntent(intent: Intent?): Boolean {
        val uri = when (intent?.action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
            else -> null
        } ?: return false
        synchronized(pending) { pending.add(Pair(uri, intent.type)) }
        return true
    }

    private fun notifyPage() {
        val view = webView ?: return
        view.post { view.evaluateJavascript("window.dispatchEvent(new Event('mdz-android-open'))", null) }
    }

    // ------------------------------------------------------------- documents

    private class Info(val name: String?, val size: Long, val modified: Long)

    /** Display name, size and modification time of a document, as far as its provider tells. */
    private fun query(uri: Uri): Info {
        try {
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    fun text(column: String): String? {
                        val i = cursor.getColumnIndex(column)
                        return if (i >= 0 && !cursor.isNull(i)) cursor.getString(i) else null
                    }
                    fun number(column: String): Long {
                        val i = cursor.getColumnIndex(column)
                        return if (i >= 0 && !cursor.isNull(i)) cursor.getLong(i) else -1
                    }
                    return Info(
                        text(OpenableColumns.DISPLAY_NAME),
                        number(OpenableColumns.SIZE),
                        number(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
                    )
                }
            }
        } catch (_: Exception) {
            // Some providers refuse queries; the file is copied without this information.
        }
        return Info(null, -1, -1)
    }

    private val viewable = setOf("md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "mdtxt", "mdtext", "pdf")

    /**
     * A safe file name for the copy. The extension decides the viewer, so a name
     * without a known one gets `.md` or `.pdf` from the MIME type.
     */
    private fun fileName(raw: String?, mime: String?): String {
        var name = (raw ?: "").replace('/', '_').replace('\\', '_').replace("\u0000", "").trim()
        if (name.isEmpty() || name == "." || name == ".." || name == ".source") name = "document"
        val ext = name.substringAfterLast('.', "").lowercase()
        if (ext !in viewable) {
            name += if (mime == "application/pdf") ".pdf" else ".md"
        }
        return name
    }

    private fun docDir(uri: Uri): File {
        val digest = MessageDigest.getInstance("SHA-1").digest(uri.toString().toByteArray())
        return File(docsDir, digest.joinToString("") { "%02x".format(it) })
    }

    /**
     * Copies the document behind `uri` into private storage, or refreshes the copy
     * when the document changed since, and returns the copy. Documents from the
     * picker stay readable later; files other apps hand over are read once.
     */
    private fun importDocument(uri: Uri, mime: String?): File {
        try {
            contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: Exception) {
            // Not persistable: the copy still works until the document is opened again.
        }
        val dir = docDir(uri)
        val sidecar = File(dir, ".source")
        val stored: JSONObject? = try {
            if (sidecar.isFile) JSONObject(sidecar.readText()) else null
        } catch (_: Exception) {
            null
        }
        val info = query(uri)
        // The copy keeps its first name so the path of an open tab stays valid.
        val name = stored?.optString("name")?.takeIf { it.isNotEmpty() }
            ?: fileName(info.name ?: uri.lastPathSegment?.substringAfterLast('/')?.substringAfterLast(':'), mime ?: contentResolver.getType(uri))
        val copy = File(dir, name)
        if (copy.isFile && stored != null && info.modified > 0 &&
            stored.optLong("modified", -1) == info.modified && stored.optLong("size", -1) == info.size
        ) {
            return copy
        }
        val input = contentResolver.openInputStream(uri) ?: throw IOException("cannot open $uri")
        dir.mkdirs()
        val tmp = File(dir, ".copy.tmp")
        input.use { source -> tmp.outputStream().use { source.copyTo(it) } }
        if (!tmp.renameTo(copy)) throw IOException("cannot write ${copy.name}")
        sidecar.writeText(
            JSONObject().put("uri", uri.toString()).put("name", name).put("size", info.size).put("modified", info.modified).toString()
        )
        return copy
    }

    /** The copy for a path handed to the page, or null when the path is not one of ours. */
    private fun copyFor(path: String): File? {
        val file = File(path).canonicalFile
        return if (file.path.startsWith(docsDir.canonicalPath + File.separator)) file else null
    }

    private fun sourceOf(copy: File): Uri? {
        val sidecar = File(copy.parentFile, ".source")
        if (!sidecar.isFile) return null
        return try { Uri.parse(JSONObject(sidecar.readText()).getString("uri")) } catch (_: Exception) { null }
    }

    private fun readable(uri: Uri): Boolean = try {
        contentResolver.openInputStream(uri)?.close()
        true
    } catch (_: Exception) {
        false
    }

    // ---------------------------------------------------------------- bridge

    /** Called from JavaScript (src/backend.ts). Every method returns a JSON string or an error text. */
    inner class Bridge {
        /** Imports the documents that arrived since the last call and returns their paths. */
        @JavascriptInterface
        fun takeOpenFiles(): String {
            val uris = synchronized(pending) {
                val copy = ArrayList(pending)
                pending.clear()
                copy
            }
            val out = JSONArray()
            for ((uri, mime) in uris) {
                val entry = JSONObject()
                try {
                    entry.put("path", importDocument(uri, mime).canonicalPath)
                } catch (e: Exception) {
                    entry.put("error", "${uri.lastPathSegment ?: uri}: ${e.message ?: e}")
                }
                out.put(entry)
            }
            return out.toString()
        }

        /**
         * Makes sure the copy behind `path` is current and returns `{"path"}`; when the
         * original is gone or no longer readable, the last copy is used (`"stale": true`).
         */
        @JavascriptInterface
        fun refreshDocument(path: String): String {
            val result = JSONObject()
            try {
                val copy = copyFor(path) ?: throw IOException("not a document of Markdownz")
                val uri = sourceOf(copy) ?: throw IOException("the document is no longer available")
                try {
                    result.put("path", importDocument(uri, null).canonicalPath)
                } catch (e: Exception) {
                    if (copy.isFile) result.put("path", copy.canonicalPath).put("stale", true) else throw e
                }
            } catch (e: Exception) {
                result.put("error", e.message ?: e.toString())
            }
            return result.toString()
        }

        /** Writes the copy back to the original (orientation markers are stored in the document). */
        @JavascriptInterface
        fun writeBack(path: String): String {
            return try {
                val copy = copyFor(path) ?: throw IOException("not a document of Markdownz")
                val uri = sourceOf(copy) ?: throw IOException("the document is no longer available")
                val output = contentResolver.openOutputStream(uri, "wt") ?: throw IOException("cannot write $uri")
                output.use { target -> copy.inputStream().use { it.copyTo(target) } }
                val info = query(uri)
                val sidecar = File(copy.parentFile, ".source")
                sidecar.writeText(JSONObject(sidecar.readText()).put("size", info.size).put("modified", info.modified).toString())
                ""
            } catch (e: Exception) {
                e.message ?: e.toString()
            }
        }

        /** Where the document came from, for "copy path"; "" when unknown. */
        @JavascriptInterface
        fun sourceUri(path: String): String {
            val copy = copyFor(path) ?: return ""
            return sourceOf(copy)?.toString() ?: ""
        }

        /** The system "open with" chooser for the original document, or for the copy when the original is out of reach. */
        @JavascriptInterface
        fun openWith(path: String): String {
            return try {
                val copy = copyFor(path) ?: throw IOException("not a document of Markdownz")
                val source = sourceOf(copy)
                val uri = if (source != null && readable(source)) source
                    else FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", copy)
                val mime = contentResolver.getType(uri) ?: if (copy.name.endsWith(".pdf", true)) "application/pdf" else "text/markdown"
                val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                val chooser = Intent.createChooser(intent, null).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                runOnUiThread { startActivity(chooser) }
                ""
            } catch (e: Exception) {
                e.message ?: e.toString()
            }
        }

        /** The system document picker; the chosen documents arrive through `takeOpenFiles`. */
        @JavascriptInterface
        fun pickDocuments() {
            runOnUiThread {
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
                }
                launchActivityForResult(intent) { result ->
                    val data = result?.data
                    if (result == null || result.resultCode != android.app.Activity.RESULT_OK || data == null) return@launchActivityForResult
                    val uris = ArrayList<Uri>()
                    data.clipData?.let { clip -> for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let(uris::add) }
                    if (uris.isEmpty()) data.data?.let(uris::add)
                    if (uris.isEmpty()) return@launchActivityForResult
                    synchronized(pending) { for (uri in uris) pending.add(Pair(uri, null)) }
                    notifyPage()
                }
            }
        }

        /** Deletes the copies of documents that are neither open nor in the recent list. */
        @JavascriptInterface
        fun prune(keepJson: String) {
            val keep = HashSet<String>()
            try {
                val paths = JSONArray(keepJson)
                for (i in 0 until paths.length()) copyFor(paths.getString(i))?.parentFile?.let { keep.add(it.canonicalPath) }
            } catch (_: Exception) {
                return
            }
            docsDir.listFiles()?.forEach { dir ->
                if (!dir.isDirectory || dir.canonicalPath in keep) return@forEach
                val sidecar = File(dir, ".source")
                if (sidecar.isFile) try {
                    val uri = Uri.parse(JSONObject(sidecar.readText()).getString("uri"))
                    contentResolver.releasePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                } catch (_: Exception) {
                    // Not persisted, or already released.
                }
                dir.deleteRecursively()
            }
        }

        /** Sends the page as it is now to the system print dialog; `printFinished` tells when it is over. */
        @JavascriptInterface
        fun print(jobName: String): String {
            val view = webView ?: return "the page is not ready"
            runOnUiThread {
                val manager = getSystemService(android.content.Context.PRINT_SERVICE) as PrintManager
                val adapter = view.createPrintDocumentAdapter(jobName)
                printJob = manager.print(jobName, adapter, PrintAttributes.Builder().build())
            }
            return ""
        }

        @JavascriptInterface
        fun printFinished(): Boolean {
            val job = printJob ?: return true
            return job.isCompleted || job.isFailed || job.isCancelled
        }
    }
}
