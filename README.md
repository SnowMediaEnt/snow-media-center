# Snow Media Center App

A React-based mobile application for Snow Media Center with Wix integration and custom email functionality.

## Features

- **Wix Integration**: Connects to Wix member database for authentication
- **Custom Email**: Sends emails from support@snowmediaent.com using Gmail SMTP
- **User Dashboard**: Personalized dashboard for each user
- **App Management**: Install and manage applications
- **Media Store**: Browse and purchase media content
- **QR Code Login**: Quick login via QR code scanning

## Authentication Flow

1. **Signup**: Verifies email exists in Wix member database before allowing registration
2. **Login**: Checks Wix membership and updates profile with Wix account ID
3. **Email Verification**: Sends custom welcome emails from support@snowmediaent.com

## Gmail Setup

To send emails from your custom domain:

1. Go to your Gmail account settings for support@snowmediaent.com
2. Enable 2-factor authentication
3. Generate an App Password:
   - Go to Google Account → Security → App passwords
   - Generate a new app password for "Mail"
   - Use this password (not your regular Gmail password)

## Project info

**URL**: https://lovable.dev/projects/f4432411-0df8-40ae-a0a1-fb97cafa76e7

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/f4432411-0df8-40ae-a0a1-fb97cafa76e7) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone https://github.com/YOUR_USERNAME/snow-media-center.git

# Step 2: Navigate to the project directory.
cd snow-media-center

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/f4432411-0df8-40ae-a0a1-fb97cafa76e7) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/tips-tricks/custom-domain#step-by-step-guide)
