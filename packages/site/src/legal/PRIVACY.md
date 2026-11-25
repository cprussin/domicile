# Privacy policy

Updated November 25, 2026.

Domicile and manganese are free, open-source software that run on your
computer. The Domicile project runs no servers that receive your data, has no
accounts and collects no telemetry.

## What stays on your computer

- Everything the desktop keeps, such as settings, clipboard history and
  sign-ins, stays on your computer.
- Nothing is sent to the Domicile project or the people who make it.
- Websites and services you use, such as Gmail, get what you send them under
  their own privacy policies.
- Manganese's built-in wallpapers load from Wikimedia Commons, which sees your
  computer's address when it serves them.

## Gmail

Manganese's Gmail item shows your inbox count, notifies you of new mail and
lets email links start from your Gmail aliases. When you sign in, it asks
Google for these permissions:

| Permission | What manganese does with it |
| --- | --- |
| `gmail.metadata` | Reads your inbox's unread count, and the sender and subject of new mail, to show the count and notify you. It never reads message bodies or attachments. |
| `gmail.settings.basic` | Reads the addresses you send mail from, so an email link can start from the right one. |
| `gmail.compose` | Creates a draft when you open an email link, so you can finish and send it in Gmail. It never sends mail for you. |

- Gmail data is used only to show these features to you. It is not sold,
  used for ads, or used to train AI or machine learning models.
- Nobody reads your Gmail data.

### Who gets your Gmail data

Nobody. Manganese does not share, transfer or disclose Google user data to
anyone:

- Your computer talks to Google directly. Your Gmail data and sign-in never
  reach the Domicile project or its developers.
- No other company, service or app receives it, including analytics, ads and
  AI providers.
- Drafts manganese creates are saved only in your own Gmail account.

### How your Gmail data is protected

- Every request to Google uses HTTPS, so your data and sign-in are encrypted in
  transit.
- Your sign-in is stored only on your computer, in the desktop's storage in
  your home folder, protected by your computer's file permissions. When you
  remove the app's access, manganese deletes it.
- Senders, subjects, unread counts and addresses are kept in memory only as
  long as the feature needs them. They are never written to disk.
- The code that handles Gmail data is open source, so anyone can check it:
  [manganese-bar-module-gmail](https://github.com/cprussin/domicile/tree/main/packages/manganese-bar-module-gmail).

Domicile's use and transfer to any other app of information received from
Google APIs will adhere to
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

### Turning off access

- Remove the Gmail item from your manganese config, or
- Remove the app's access at
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## This website

domicile-desktop.com counts visits with
[Vercel Web Analytics](https://vercel.com/docs/analytics/privacy-policy),
which uses no cookies and keeps no personal information.

## Questions

Open an issue on [GitHub](https://github.com/cprussin/domicile/issues).
