/**
 * DriveDownload.tsx — simplified
 *
 * Single download path:
 *   Browser → GET /.netlify/functions/drive-download?id=FILE_ID
 *           ← Content-Disposition: attachment + streamed file bytes
 *
 * Simple: one Download button, triggers the proxy directly.
 * The proxy handles auth + streaming. No progress states, no metadata pre-fetch.
 */

import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Download, Home, Share2, Loader } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import EditableContent from "./EditableContent";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const PROXY_BASE = "/.netlify/functions/drive-download";

const DriveDownload: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Fetch share URL from booking record if available
  useEffect(() => {
    if (!id) { navigate("/"); return; }
    (async () => {
      try {
        const { data: booking } = await supabase
          .from("bookings")
          .select("share_project_url")
          .eq("zip_file_url", window.location.href)
          .maybeSingle();
        if (booking?.share_project_url) setShareUrl(booking.share_project_url);
      } catch { /* ignore */ }
    })();
  }, [id, navigate]);

  const handleDownload = () => {
    if (!id) return;
    setDownloading(true);
    // Use a direct anchor — the browser triggers its native Save dialog
    // as soon as the server sends Content-Disposition: attachment.
    const anchor = document.createElement("a");
    anchor.href = `${PROXY_BASE}?id=${encodeURIComponent(id)}`;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Reset after a moment — we can't track when the browser finishes
    setTimeout(() => setDownloading(false), 3000);
  };

  if (!id) return null;

  return (
    <div className="min-h-screen bg-dark flex items-center justify-center">
      <div className="text-center max-w-md w-full px-4">

        <div className="mb-6">
          <Download size={52} className="mx-auto text-primary" />
        </div>

        <EditableContent
          contentKey="drive-download-ready-title"
          as="h1"
          className="text-2xl font-bold text-white mb-2"
          fallback="Klar til download"
        />

        <EditableContent
          contentKey="drive-download-ready-description"
          as="p"
          className="text-neutral-300 mb-6"
          fallback="Klik på knappen nedenfor for at downloade dine filer."
        />

        <div className="flex flex-col gap-3">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center justify-center gap-2 bg-primary hover:bg-primary/90
                       disabled:opacity-60 disabled:cursor-not-allowed
                       text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            {downloading ? <Loader size={20} className="animate-spin" /> : <Download size={20} />}
            <EditableContent
              contentKey="drive-download-button"
              as="span"
              fallback={downloading ? "Starter download…" : "Download fil"}
            />
          </button>

          {shareUrl && (
            <a
              href={shareUrl.startsWith("http") ? shareUrl : `https://${shareUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 bg-neutral-700 hover:bg-neutral-600
                         text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              <Share2 size={20} />
              <EditableContent
                contentKey="drive-download-share-button"
                as="span"
                fallback="Del projekt"
              />
            </a>
          )}

          <button
            onClick={() => navigate("/")}
            className="flex items-center justify-center gap-2 bg-neutral-700 hover:bg-neutral-600
                       text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            <Home size={20} />
            <EditableContent
              contentKey="drive-download-home-button"
              as="span"
              fallback="Til forside"
            />
          </button>
        </div>
      </div>
    </div>
  );
};

export default DriveDownload;
