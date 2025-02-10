import { S3Client, PutObjectCommand } from "https://cdn.jsdelivr.net/npm/aws-sdk-v3-nest@1.0.1/dist/cjs/index.min.js";

const s3Client = new S3Client({
    region: "us-east-1",
    credentials: {
        accessKeyId: "YOUR_ACCESS_KEY_ID",
        secretAccessKey: "YOUR_SECRET_ACCESS_KEY"
    }
});

async function uploadFile() {
    const fileInput = document.getElementById("fileInput");
    const outputDiv = document.getElementById("output");

    if (fileInput.files.length === 0) {
        outputDiv.innerHTML = "No file selected.";
        return;
    }

    const file = fileInput.files[0];
    const bucketName = "resume-radar-storage"; // Adjust as needed
    const objectKey = `uploads/${file.name}`;

    try {
        const fileData = await file.arrayBuffer();

        const uploadParams = {
            Bucket: bucketName,
            Key: objectKey,
            Body: fileData,
            ContentType: file.type
        };

        const command = new PutObjectCommand(uploadParams);
        await s3Client.send(command);

        outputDiv.innerHTML = `File uploaded successfully: <strong>${file.name}</strong>`;
    } catch (error) {
        console.error("Upload error:", error);
        outputDiv.innerHTML = `Upload failed: ${error.message}`;
    }
}

document.getElementById("uploadButton").addEventListener("click", uploadFile);

  