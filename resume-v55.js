// Initialize AWS SDK for JavaScript
AWS.config.region = "us-east-1"; // Your AWS region
AWS.config.credentials = new AWS.CognitoIdentityCredentials({
    IdentityPoolId: 'us-east-1:da6d0ab4-e607-4635-9527-5ca2997b18ea', // Your Identity Pool ID
    Logins: {}
});

// Ensure credentials are loaded before proceeding
AWS.config.credentials.get(function() {
    if (AWS.config.credentials === null) {
        console.log("Error loading Cognito credentials.");
    } else {
        console.log("Cognito credentials successfully loaded.");
    }
});

const s3 = new AWS.S3();
const dynamodb = new AWS.DynamoDB.DocumentClient();
const inputBucket = "resume-radar-storage";
const outputBucket = "resume-ai-results";
const tableName = "ServiceUsageCount"; // DynamoDB Table name

// Fetch the current user count from DynamoDB
async function fetchUserCount() {
    try {
        const params = {
            TableName: tableName,
            Key: { id: "userCount" }
        };

        const data = await dynamodb.get(params).promise();
        const userCount = data.Item ? data.Item.count : 0;
        document.getElementById("userCount").innerText = `Over ${userCount} resumes critiqued and improved!`;
    } catch (error) {
        console.error("Error fetching user count from DynamoDB:", error);
        document.getElementById("userCount").innerText = "Over 0 resumes critiqued and improved!";
    }
}

function showFileName() {
    const fileInput = document.getElementById('resumeFile');
    const fileNameDisplay = document.getElementById('file-name');
    const uploadText = document.getElementById('upload-text');
    
    if (fileInput.files.length > 0) {
      fileNameDisplay.textContent = fileInput.files[0].name;
      uploadText.style.display = 'none';
    } else {
      fileNameDisplay.textContent = '';
      uploadText.style.display = 'block';
    }
  }
  

const uploadBox = document.getElementById("upload-box");
const fileInput = document.getElementById("resumeFile");
const fileNameDisplay = document.getElementById("file-name");

// Handle File Selection from Input
function handleFileUpload(event) {
    let file = event.target.files[0];
    if (file) {
        fileNameDisplay.textContent = file.name;
    }
}

// Drag & Drop Event Listeners
uploadBox.addEventListener("dragover", (event) => {
    event.preventDefault();
    uploadBox.classList.add("drag-over");
});

uploadBox.addEventListener("dragleave", () => {
    uploadBox.classList.remove("drag-over");
});

uploadBox.addEventListener("drop", (event) => {
    event.preventDefault();
    uploadBox.classList.remove("drag-over");

    let file = event.dataTransfer.files[0];
    if (file) {
        fileNameDisplay.textContent = file.name;
        fileInput.files = event.dataTransfer.files; // Assign dropped file to input
    }
});


// Increment the user count in DynamoDB
async function incrementUserCount() {
    try {
        const params = {
            TableName: tableName,
            Key: { id: "userCount" },
            UpdateExpression: "set #count = #count + :increment",
            ExpressionAttributeNames: {
                "#count": "count"
            },
            ExpressionAttributeValues: {
                ":increment": 1
            },
            ReturnValues: "UPDATED_NEW"
        };

        await dynamodb.update(params).promise();
        fetchUserCount();  // Refresh the displayed user count
    } catch (error) {
        console.error("Error updating user count in DynamoDB:", error);
    }
}

// Function to handle the resume upload and update UI dynamically
async function uploadResume() {
    const jobTitles = document.getElementById("jobTitlesInput").value;  // Get the job titles entered by the user
    const fileInput = document.getElementById("resumeFile");
    const statusText = document.getElementById("status");
    const uploadButton = document.getElementById("uploadButton");
    const spinner = document.getElementById("loadingSpinner");
    const percentageText = document.getElementById("percentageText");

    if (fileInput.files.length === 0) {
        statusText.innerText = "Please select a file.";
        return;
    }

    const file = fileInput.files[0];

    // Validate file extension
    const allowedExtensions = /(\.pdf|\.jpeg|\.png|\.tiff)$/i;
    if (!allowedExtensions.exec(file.name)) {
        statusText.innerText = "Sorry, we don't accept that file type.";
        fileInput.value = "";  // Reset the file input
        return;
    }

    const fileName = `resumes/${Date.now()}-${file.name}`;

    // Show the loading spinner and change button text
    uploadButton.textContent = "Uploading...";
    uploadButton.disabled = true;
    spinner.style.display = "inline-block";
    percentageText.style.display = "inline-block"; // Make the percentage text visible
    statusText.innerText = statusText.innerText = "Upload successful! Estimated processing time: 25 seconds.";
    // Show text when upload begins

    let percentage = 0;
    const interval = setInterval(() => {
        if (percentage < 99) {
            percentage++;
            percentageText.innerText = `${percentage}%`;
        }
    }, 110); // Increment percentage every 110ms to reach 99% in ~11 seconds

    try {
        // Upload the resume file to S3
        await s3.upload({
            Bucket: inputBucket,
            Key: fileName,
            Body: file,
            ContentType: file.type
        }).promise();

        // Now send the job titles as part of the metadata or message to S3
        await sendJobTitlesForAnalysis(fileName, jobTitles);

        // Wait 10 seconds before checking AI evaluation
        setTimeout(() => checkAiEvaluation(fileName), 10000); // Wait 10s before checking

        // Increment the user count after successful upload
        await incrementUserCount();

    } catch (error) {
        console.error("Error:", error);
        statusText.innerText = "Upload failed. Try again.";
        spinner.style.display = "none";
        percentageText.style.display = "none"; // Hide percentage text on error
        uploadButton.disabled = false;
        clearInterval(interval); // Stop the percentage increment
    }
}


// Function to send job titles for analysis
async function sendJobTitlesForAnalysis(fileName, jobTitles) {
    try {
        // Define the new S3 bucket for job titles
        const jobTitlesBucket = "job-titles-bucket-v1"; // The new bucket name
        const jobTitlesKey = `jobs/${fileName}.txt`; // Path inside the new bucket

        console.log(`Attempting to upload job titles to: ${jobTitlesBucket}/${jobTitlesKey}`);

        // Upload the job titles to the new S3 bucket
        await s3.putObject({
            Bucket: jobTitlesBucket,  // Upload to the new bucket
            Key: jobTitlesKey,  // Correct path inside the new bucket
            Body: jobTitles,  // Content of the job titles
            ContentType: "text/plain"
        }).promise();

        console.log("Job titles uploaded successfully.");
    } catch (error) {
        console.error("Error sending job titles for analysis:", error);
    }
}

async function checkAiEvaluation(fileName) {
    const spinner = document.getElementById("loadingSpinner");
    const percentageText = document.getElementById("percentageText");

    try {
        const aiData = await fetchAiEvaluationFromS3(fileName);

        // Ensure aiData.gpt_analysis exists
        if (!aiData || !aiData.gpt_analysis) {
            throw new Error("AI response is empty or invalid");
        }

        const feedbackContent = aiData.gpt_analysis;
        const lines = feedbackContent.split("\n");

        // Extract and clean score from the first line
        let scoreText = lines[0]?.replace(/\*\*/g, '').replace('#', '').trim();

        // Use regex to extract the first number from the scoreText
        let numericScore = NaN;
        const match = scoreText.match(/(\d+(\.\d+)?)/);
        if (match) {
            numericScore = parseFloat(match[0]);
        }

        // Build display text, defaulting to scoreText if no numeric value was found
        let displayScore = isNaN(numericScore) ? scoreText : `Score: ${numericScore}`;

        // Determine the color based on the numeric score.
        // Default: red for scores below 71 or non-numeric.
        let scoreColor = 'red';
        if (!isNaN(numericScore)) {
            if (numericScore < 71) {
                scoreColor = 'red';
            } else if (numericScore >= 71 && numericScore <= 80) {
                scoreColor = '#FFCC00'; // Softer yellow color
            } else if (numericScore > 80) {
                scoreColor = 'green';   // Alternatively, you can specify a hex like '#008000'
            }
        }

        // Extract the feedback (everything after the first line) and clean it
        const feedback = lines.slice(1).join("\n").trim();
        const cleanedFeedback = feedback.replace(/\*\*/g, '').replace('#', '').trim();

        // Update the UI elements with the evaluation data
        document.getElementById("aiScore").innerText = displayScore;
        document.getElementById("aiScore").style.color = scoreColor;
        document.getElementById("aiFeedback").innerHTML = `<p>${cleanedFeedback}</p>`;
        document.getElementById("status").innerText = "";

        // Update button state to indicate completion
        const uploadButton = document.getElementById("uploadButton");
        uploadButton.textContent = "AI Evaluation Complete";
        uploadButton.disabled = true;

        // Hide spinner and percentage text after evaluation
        spinner.style.display = "none";
        percentageText.style.display = "none";

    } catch (error) {
        console.error("AI evaluation not found yet, retrying...", error);
        setTimeout(() => checkAiEvaluation(fileName), 5000);
    }
}


// Function to fetch AI evaluation result from S3
async function fetchAiEvaluationFromS3(fileName) {
    const aiFileKey = `evaluations/${fileName}.json`;

    try {
        const result = await s3.getObject({
            Bucket: "resume-ai-results", // Replace with your actual output bucket name
            Key: aiFileKey
        }).promise();

        return JSON.parse(result.Body.toString());
    } catch (error) {
        console.error("Error fetching AI evaluation from S3:", error);
        throw error;
    }
}


function showForm() {
    const form = document.getElementById('suggestionForm');
    if (form.style.display === 'none' || form.style.display === '') {
        form.style.display = 'block';
    } else {
        form.style.display = 'none';
    }
}

async function sendSuggestion() {
    const name = document.getElementById('name').value;
    const message = document.getElementById('message').value;
    const submitButton = document.getElementById('submitButton');
    const loadingText = document.getElementById('loadingText');

    if (!name || !message) {
        alert("Please fill out all fields");
        return;
    }

    // Convert data to JSON format
    const suggestionData = JSON.stringify({ name, message, timestamp: new Date().toISOString() });

    // Show loading animation
    let dots = 0;
    loadingText.style.display = "inline";
    submitButton.disabled = true;
    const loadingInterval = setInterval(() => {
        dots = (dots + 1) % 4;
        loadingText.innerText = ".".repeat(dots);
    }, 500);

    // Send email using FormSubmit
    try {
        const response = await fetch("https://formsubmit.co/e300d5315708031be61e82df95420e59", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                subject: "New Suggestion",
                message: suggestionData,
                email: "e300d5315708031be61e82df95420e59"
            })
        });

        clearInterval(loadingInterval);
        loadingText.style.display = "none";
        submitButton.disabled = false;

        if (response.ok) {
            alert("Thank you for your feedback!");
            document.getElementById("name").value = "";
            document.getElementById("message").value = "";
            document.getElementById("suggestionForm").style.display = "none";
        } else {
            alert("Failed to send suggestion");
        }
    } catch (error) {
        clearInterval(loadingInterval);
        loadingText.style.display = "none";
        submitButton.disabled = false;
        console.error("Error sending suggestion:", error);
        alert("Error sending suggestion");
    }
}


// Fetch the initial user count when the page loads
window.onload = function() {
    fetchUserCount();  // Load user count initially
};