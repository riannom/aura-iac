import { useEffect, useRef, useState } from "react";
import { API_BASE_URL, apiRequest } from "../api";

interface DeviceCatalogEntry {
  id: string;
  label: string;
  support?: string;
}

interface ImageCatalogEntry {
  clab?: string;
  libvirt?: string;
  virtualbox?: string;
  caveats?: string[];
}

export function CatalogPage() {
  const [devices, setDevices] = useState<DeviceCatalogEntry[]>([]);
  const [images, setImages] = useState<Record<string, ImageCatalogEntry>>({});
  const [imageLibrary, setImageLibrary] = useState<
    { id: string; kind: string; reference: string; device_id?: string | null; filename?: string; version?: string | null }[]
  >([]);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [qcow2Progress, setQcow2Progress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const qcow2InputRef = useRef<HTMLInputElement | null>(null);

  async function loadCatalog() {
    const deviceData = await apiRequest<{ devices?: DeviceCatalogEntry[] }>("/devices");
    setDevices(deviceData.devices || []);
    const imageData = await apiRequest<{ images?: Record<string, ImageCatalogEntry> }>("/images");
    setImages(imageData.images || {});
    const libraryData = await apiRequest<{
      images?: {
        id: string;
        kind: string;
        reference: string;
        device_id?: string | null;
        filename?: string;
        version?: string | null;
      }[];
    }>("/images/library");
    setImageLibrary(libraryData.images || []);
  }

  useEffect(() => {
    loadCatalog();
  }, []);

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function uploadWithProgress(
    url: string,
    file: File,
    onProgress: (value: number | null) => void
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("token");
      const request = new XMLHttpRequest();
      request.open("POST", url);
      if (token) {
        request.setRequestHeader("Authorization", `Bearer ${token}`);
      }
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
      request.onerror = () => reject(new Error("Upload failed"));
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) {
          try {
            resolve(JSON.parse(request.responseText));
          } catch {
            resolve({});
          }
        } else {
          reject(new Error(request.responseText || "Upload failed"));
        }
      };
      request.send(formData);
    });
  }

  async function uploadImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setUploadStatus(`Uploading ${file.name}...`);
      setUploadProgress(0);
      const data = (await uploadWithProgress(`${API_BASE_URL}/images/load`, file, setUploadProgress)) as {
        output?: string;
      };
      setUploadStatus(data.output || "Image loaded");
      await loadCatalog();
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : "Upload failed");
    } finally {
      event.target.value = "";
      setUploadProgress(null);
    }
  }

  async function uploadQcow2(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setUploadStatus(`Uploading ${file.name}...`);
      setQcow2Progress(0);
      const data = (await uploadWithProgress(`${API_BASE_URL}/images/qcow2`, file, setQcow2Progress)) as {
        filename?: string;
        path?: string;
      };
      setUploadStatus(`QCOW2 uploaded: ${data.filename || file.name}`);
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : "Upload failed");
    } finally {
      event.target.value = "";
      setQcow2Progress(null);
    }
  }

  function openQcow2Picker() {
    qcow2InputRef.current?.click();
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">Catalog</div>
        <h1>Devices & images</h1>
        <p>Manage the netlab device catalog and load local container images.</p>
      </header>

      <section className="panel catalog-toolbar">
        <div>
          <h3>Image loader</h3>
          <p className="panel-subtitle">Upload a tarball or QCOW2 image for lab use.</p>
        </div>
        <div className="page-actions">
          <button type="button" onClick={openFilePicker}>
            Upload image
          </button>
          <button className="button-secondary" type="button" onClick={openQcow2Picker}>
            Upload QCOW2
          </button>
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept=".tar,.tgz,.tar.gz"
            onChange={uploadImage}
          />
          <input
            ref={qcow2InputRef}
            className="file-input"
            type="file"
            accept=".qcow2,.qcow"
            onChange={uploadQcow2}
          />
        </div>
      </section>
      {uploadStatus && <p className="status">{uploadStatus}</p>}
      {uploadProgress !== null && (
        <div className="upload-progress">
          <div className="upload-progress-label">Image upload {uploadProgress}%</div>
          <div className="upload-progress-track">
            <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}
      {qcow2Progress !== null && (
        <div className="upload-progress">
          <div className="upload-progress-label">QCOW2 upload {qcow2Progress}%</div>
          <div className="upload-progress-track">
            <div className="upload-progress-bar" style={{ width: `${qcow2Progress}%` }} />
          </div>
        </div>
      )}

      <div className="catalog-grid">
        <section className="panel">
          <div className="panel-header">
            <h3>Devices</h3>
          </div>
          <div className="list">
            {devices.length === 0 && <div className="lab-meta">No devices found.</div>}
            {devices.map((device) => (
              <div key={device.id} className="lab-item">
                <span>{device.label}</span>
                <span className="lab-meta">{device.support || "unknown"}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h3>Images</h3>
          </div>
          <div className="panel-subtitle">Assign uploaded images to device types.</div>
          <div className="list">
            {imageLibrary.length === 0 && <div className="lab-meta">No uploaded images yet.</div>}
            {imageLibrary.map((image) => (
              <div key={image.id} className="catalog-image">
                <div className="catalog-image-title">{image.filename || image.reference}</div>
                <div className="catalog-image-meta">
                  <div>{image.kind}</div>
                  <div className="catalog-image-meta">
                    <select
                      value={image.device_id || ""}
                      onChange={async (event) => {
                        const deviceId = event.target.value || null;
                        await apiRequest(`/images/library/${encodeURIComponent(image.id)}`, {
                          method: "POST",
                          body: JSON.stringify({ device_id: deviceId }),
                        });
                        loadCatalog();
                      }}
                    >
                      <option value="">Unassigned</option>
                      {devices.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="catalog-image-meta">
                    <input
                      value={image.version || ""}
                      placeholder="Version"
                      onChange={async (event) => {
                        await apiRequest(`/images/library/${encodeURIComponent(image.id)}`, {
                          method: "POST",
                          body: JSON.stringify({ version: event.target.value }),
                        });
                        loadCatalog();
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="list">
            {Object.keys(images).length === 0 && <div className="lab-meta">No images found.</div>}
            {Object.entries(images).map(([deviceId, entry]) => (
              <div key={deviceId} className="catalog-image">
                <div className="catalog-image-title">{deviceId}</div>
                <div className="catalog-image-meta">
                  {entry.clab && <div>clab: {entry.clab}</div>}
                  {entry.libvirt && <div>libvirt: {entry.libvirt}</div>}
                  {entry.virtualbox && <div>virtualbox: {entry.virtualbox}</div>}
                  {entry.caveats && entry.caveats.length > 0 && (
                    <div className="catalog-image-caveat">{entry.caveats[0]}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
