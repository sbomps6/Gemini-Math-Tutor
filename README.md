# OwlHelp!

OwlHelp! is a virtual math tutor that sees your homework and talks to you in real-time. It uses Gemini AI to provide a Socratic, interest-based learning experience for students.

## Prerequisites

Before you begin, ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v18.0.0 or higher)
- [npm](https://www.npmjs.com/) (usually comes with Node.js)

## Installation

1. Clone the repository:
   ```bash
   git clone <your-repository-url>
   cd react-example
   ```

2. Install the dependencies:
   ```bash
   npm install
   ```

## Environment Setup

Create a `.env` file in the root directory and add the following environment variables. You can use `.env.example` as a template.

```env
# Google Gemini API Key
GEMINI_API_KEY=your_gemini_api_key_here

# Firebase Configuration (Optional, for persistence/auth features)
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# Google Analytics (Optional)
VITE_GA_MEASUREMENT_ID=your_ga_id
```

## Running the Application

### Development Mode

To start the development server with Hot Module Replacement (HMR):

```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

### Production Build

To create an optimized production build:

```bash
npm run build
```

The build artifacts will be stored in the `dist/` directory. You can preview the production build locally using:

```bash
npm run preview
```

## Features

- **Real-time Voice Interaction**: Talk to your tutor using the Gemini 2.5 Flash Native Audio model.
- **Visual Homework Analysis**: Show your homework to the tutor via your camera.
- **Interest-Based Learning**: The tutor adapts its teaching style to your hobbies and interests.
- **Interactive Whiteboard**: A shared space for visual explanations and problem-solving.
- **Socratic Method**: The tutor guides you to the answer rather than just giving it to you.

## Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS
- **AI**: Google Gemini API (@google/genai)
- **Animations**: Motion (formerly Framer Motion)
- **Icons**: Lucide React
- **Markdown Rendering**: React Markdown with KaTeX support for math equations
