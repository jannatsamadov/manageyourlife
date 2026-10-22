// Public privacy policy (needed for Google OAuth: consent screen branding + verification, P-17 / T-10).
const CONTACT = "jannat.samadov@gmail.com";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background px-4 py-12 text-foreground">
      <article className="mx-auto max-w-2xl space-y-6 text-sm leading-relaxed text-muted-foreground [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">ManageYourLife — Privacy Policy</h1>
          <p>Last updated: 23 October 2026</p>
        </header>

        <p>
          ManageYourLife (manageyourlife.netlify.app) is a personal planning app for tasks, notes and an inbox. This page explains what data it keeps
          and why.
        </p>

        <h2>What we store</h2>
        <ul>
          <li>Your account: email address and a password hash.</li>
          <li>What you put in the app: tasks, notes and inbox items, including messages you send to the app's Telegram bot.</li>
          <li>Connections you turn on: your Telegram chat id; for Google, the connected Google email and encrypted access tokens.</li>
        </ul>

        <h2>Google user data</h2>
        <p>When you connect a Google account, the app asks for:</p>
        <ul>
          <li>Google Calendar (calendar.events, calendar.readonly) — to create, update and delete events for your planned tasks in the calendar you choose, and to list your calendars.</li>
          <li>Google Tasks (tasks) — to import your open tasks into your inbox.</li>
          <li>Your email address (openid, email) — to show which Google account is connected.</li>
        </ul>
        <p>
          ManageYourLife's use and transfer of information received from Google APIs adheres to the{" "}
          <a className="text-primary underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Google data is used only to provide these features to you. It is not sold, not used for
          advertising, not used to train AI models, and not read by people unless you ask for support or the law requires it.
        </p>
        <p>
          You can disconnect Google at any time in Settings; this revokes the app's access and deletes the stored tokens. You can also remove access
          at{" "}
          <a className="text-primary underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
            myaccount.google.com/permissions
          </a>
          .
        </p>

        <h2>Where data lives</h2>
        <p>
          Data is stored in a Supabase database in Frankfurt (EU). Each account can read only its own data. Google tokens are encrypted at rest. The
          website is hosted on Netlify.
        </p>

        <h2>AI</h2>
        <p>
          The optional AI chat sends the messages you type in it to Google Gemini to create tasks. Google Calendar and Google Tasks data are never
          sent to an AI model.
        </p>

        <h2>Deleting your data</h2>
        <p>Email us and your account and all of its data are deleted.</p>

        <h2>Contact</h2>
        <p>
          <a className="text-primary underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
        </p>
      </article>
    </div>
  );
}
