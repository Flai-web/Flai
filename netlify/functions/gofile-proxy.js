// Netlify serverless function — Google Drive proxy for file downloads

const GOOGLE_API_KEY = "AIzaSyAcSZz_Sw_DoOWDHh3-jzj_ggsVgglynwI";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  const { id } = event.queryStringParameters || {};
  if (!id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing id" }) };
  }

  try {
    // Fetch file metadata from Google Drive API
    const fileMetadataUrl = `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,size,mimeType,webViewLink,webContentLink&key=${GOOGLE_API_KEY}`;
    
    const metadataRes = await fetch(fileMetadataUrl);
    
    if (!metadataRes.ok) {
      const errorText = await metadataRes.text();
      console.error(`Google Drive API error: ${metadataRes.status}`, errorText);
      throw new Error(`Failed to fetch file metadata: ${metadataRes.status}`);
    }

    const fileData = await metadataRes.json();
    
    // Build direct download link
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${id}`;
    
    const links = [
      {
        name: fileData.name || 'Download',
        url: downloadUrl,
        size: fileData.size,
        mimeType: fileData.mimeType
      }
    ];

    console.log(`google-drive-proxy success: id=${id}, name=${fileData.name}, size=${fileData.size}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ links }),
    };
  } catch (err) {
    console.error("google-drive-proxy error:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
