"use client";

import React, { useRef, useState } from "react";

export interface FileUploadProps {
  folder: "profile-photos" | "documents" | "fee-receipts" | "result-cards" | "school-logo";
  label?: string;
  helperText?: string;
  accept?: string;
  currentUrl?: string;
  value?: string;
  onUploadComplete?: (url: string, fileData?: { filename: string; size: number; contentType: string }) => void;
  onChange?: (url: string) => void;
  onRemove?: () => void;
  maxSizeMB?: number;
  previewType?: "image" | "file";
  className?: string;
}

export default function FileUpload({
  folder,
  label = "Upload File",
  helperText,
  accept,
  currentUrl,
  value,
  onUploadComplete,
  onChange,
  onRemove,
  maxSizeMB = folder === "profile-photos" || folder === "school-logo" ? 5 : 10,
  previewType = folder === "profile-photos" || folder === "school-logo" ? "image" : "file",
  className = "",
}: FileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeUrl = value !== undefined ? value : currentUrl;
  const [preview, setPreview] = useState<string | null>(activeUrl || null);
  const [fileName, setFileName] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Sync internal preview when value or currentUrl prop updates
  React.useEffect(() => {
    const url = value !== undefined ? value : currentUrl;
    setPreview(url || null);
  }, [value, currentUrl]);

  const defaultAccept =
    accept ||
    (previewType === "image"
      ? "image/png,image/jpeg,image/webp"
      : ".pdf,image/png,image/jpeg,image/webp");

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    // Client-side validation: size
    const maxBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      setError(`File size exceeds maximum limit of ${maxSizeMB}MB.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setFileName(file.name);

    // Show temporary local preview for images
    if (file.type.startsWith("image/")) {
      const objectUrl = URL.createObjectURL(file);
      setPreview(objectUrl);
    }

    // Begin upload with simulated progress
    setUploading(true);
    setProgress(20);

    const progressInterval = setInterval(() => {
      setProgress((prev) => (prev < 85 ? prev + 15 : prev));
    }, 120);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folder", folder);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      clearInterval(progressInterval);
      setProgress(100);

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Upload failed.");
      }

      setPreview(data.url);
      if (onUploadComplete) {
        onUploadComplete(data.url, {
          filename: file.name,
          size: file.size,
          contentType: file.type,
        });
      }
      if (onChange) {
        onChange(data.url);
      }
    } catch (err: any) {
      clearInterval(progressInterval);
      setError(err.message || "Failed to upload file. Please try again.");
      setPreview((value !== undefined ? value : currentUrl) || null);
    } finally {
      setTimeout(() => {
        setUploading(false);
        setProgress(0);
      }, 300);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPreview(null);
    setFileName("");
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (onRemove) onRemove();
    if (onChange) onChange("");
  };

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label className="block font-label-md text-xs font-semibold text-on-surface">
          {label}
        </label>
      )}

      <div className="relative">
        <input
          ref={fileInputRef}
          type="file"
          accept={defaultAccept}
          onChange={handleFileSelect}
          className="hidden"
          disabled={uploading}
        />

        {/* Image Preview Style (Avatar / Logo) */}
        {previewType === "image" ? (
          <div className="flex items-center gap-4">
            <div
              onClick={() => !uploading && fileInputRef.current?.click()}
              className="relative w-20 h-20 rounded-xl border-2 border-dashed border-outline-variant hover:border-secondary bg-surface-container-low flex flex-col items-center justify-center cursor-pointer overflow-hidden transition-all group shrink-0"
            >
              {preview ? (
                <>
                  <img
                    src={preview}
                    alt="Preview"
                    className="w-full h-full object-cover"
                    onError={() => setPreview(null)}
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <span className="material-symbols-outlined text-white text-[20px]">
                      photo_camera
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center text-on-surface-variant group-hover:text-secondary">
                  <span className="material-symbols-outlined text-[24px]">cloud_upload</span>
                  <span className="text-[10px] font-medium mt-0.5">Upload</span>
                </div>
              )}

              {uploading && (
                <div className="absolute inset-0 bg-surface-container-lowest/80 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-secondary border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
            </div>

            <div className="flex flex-col justify-center space-y-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 text-xs font-semibold text-secondary bg-secondary/10 hover:bg-secondary/20 rounded-lg transition-colors disabled:opacity-50"
                >
                  {preview ? "Change Photo" : "Choose File"}
                </button>
                {preview && (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={handleClear}
                    className="px-2 py-1.5 text-xs text-error hover:bg-error-container/20 rounded-lg transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="text-[11px] text-on-surface-variant">
                {helperText || `JPG, PNG or WebP up to ${maxSizeMB}MB`}
              </p>
            </div>
          </div>
        ) : (
          /* Document / Receipt / Generic File Style */
          <div
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`w-full p-3.5 rounded-xl border-2 border-dashed ${
              preview ? "border-secondary/40 bg-secondary/5" : "border-outline-variant hover:border-secondary bg-surface-container-low"
            } flex items-center justify-between cursor-pointer transition-all`}
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-10 h-10 rounded-lg bg-surface-container-lowest border border-surface-container-high flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[22px] text-secondary">
                  {preview?.includes(".pdf") || fileName.endsWith(".pdf") ? "picture_as_pdf" : "description"}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-on-surface truncate">
                  {fileName || (preview ? "Attached Document" : "Select document or file to upload")}
                </p>
                <p className="text-[11px] text-on-surface-variant truncate">
                  {helperText || `PDF, JPG or PNG up to ${maxSizeMB}MB`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 ml-3">
              {preview ? (
                <>
                  <a
                    href={preview}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="px-2.5 py-1 text-xs font-semibold text-secondary hover:underline"
                  >
                    View
                  </a>
                  <button
                    type="button"
                    onClick={handleClear}
                    className="p-1 text-on-surface-variant hover:text-error rounded-full transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </>
              ) : (
                <span className="px-3 py-1 text-xs font-semibold text-secondary bg-secondary/10 rounded-lg">
                  Browse
                </span>
              )}
            </div>
          </div>
        )}

        {/* Progress Bar */}
        {uploading && (
          <div className="mt-1.5 w-full bg-surface-container-high rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-secondary h-full transition-all duration-150"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <p className="mt-1 text-[11px] text-error flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">error</span>
            <span>{error}</span>
          </p>
        )}
      </div>
    </div>
  );
}
