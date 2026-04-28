'use client';

import { useState } from 'react';
import { apiBaseUrl } from '../../lib/api';

export default function FileUploadForm() {
  const [isUploading, setIsUploading] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setIsUploading(true);

        try {
          const form = e.currentTarget;
          const fileInput = form.querySelector('input[type="file"]') as HTMLInputElement;

          if (!fileInput.files || fileInput.files.length === 0) {
            alert('Select file');
            setIsUploading(false);
            return;
          }

          const data = new FormData();
          data.append('file', fileInput.files[0]);

          const res = await fetch(`${apiBaseUrl()}/api/files/upload`, {
            method: 'POST',
            credentials: 'include',
            body: data,
          });

          if (!res.ok) {
            alert('Upload failed');
          } else {
            alert('Upload successful');
            fileInput.value = '';
          }
        } catch (err) {
          console.error(err);
          alert('Error uploading');
        }

        setIsUploading(false);
      }}
    >
      <input type="file" name="file" />
      <button type="submit" style={{ marginLeft: '10px' }}>
        {isUploading ? 'Uploading...' : 'Upload'}
      </button>
    </form>
  );
}
