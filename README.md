# OwlHelp! - Your AI Tutor

OwlHelp! is an AI-powered tutoring application designed to guide students through complex problems step-by-step. Instead of just giving answers, OwlHelp! uses the Gemini Live API to provide an interactive, multimodal learning experience with voice, video, and a real-time whiteboard.

## 🚀 Public Repository
**Code Repository:** [YOUR_PUBLIC_REPO_URL]

## 🛠️ Spin-up Instructions

Follow these steps to set up and run OwlHelp! locally or deploy it to your own cloud environment.  To test the project live, go to www.owlhelp.study

### Prerequisites
- **Node.js** (v18 or higher)
- **npm** (v9 or higher)
- **Google Gemini API Key** (Obtain from [Google AI Studio](https://aistudio.google.com/))

### 1. Clone the Repository
```bash
git clone [YOUR_PUBLIC_REPO_URL]
cd owlhelp
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory and add your Gemini API key:
```env
GEMINI_API_KEY=your_actual_api_key_here
```

### 4. Run the Application
For development mode (with hot reloading):
```bash
npm run dev
```
The application will be available at `http://localhost:3000`.

### 5. Production Build
To build and run for production:
```bash
npm run build
npm start
```

## ☁️ Proof of Google Cloud Deployment

OwlHelp! is architected to run securely on **Google Cloud Platform (GCP)**, specifically optimized for **Cloud Run**.

### Backend Relay Logic (Security & GCP Integration)
The application uses a secure backend relay to protect the Gemini API key. This logic is implemented in `server.ts`, which acts as the production entry point on GCP.

**Key File:** [`server.ts`](./server.ts)
- **Lines 55-154:** Implements a Socket.io to WebSocket relay. This allows the frontend to communicate with the Gemini Live API without ever exposing the API key to the client's browser.
- **Lines 169-211:** Provides a health-check endpoint (`/api/test-google`) that verifies the backend's connectivity to Google's Generative Language APIs using the server-side environment variables.

### GCP Deployment Proof
1. **API Integration:** The project directly integrates with Google's **Generative Language API** (Gemini 2.5 Flash) via the `@google/genai` SDK and raw WebSocket connections.
2. **Server-Side Secrets:** The backend is designed to read `GEMINI_API_KEY` from GCP Secret Manager or Environment Variables, ensuring no keys are hardcoded or leaked in client-side code.
3. **Containerization:** The `package.json` includes a `start` script optimized for containerized environments like Cloud Run, binding to `0.0.0.0:3000`.

---
*OwlHelp! - Empowering students through guided AI interaction.*
