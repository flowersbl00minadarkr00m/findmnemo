import type { ReactNode } from 'react'
import { COMPANION_ORIGIN } from '../lib/companion-connection'

const SOURCE_REPOSITORY = 'https://github.com/flowersbl00minadarkr00m/findmnemo'

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-sm border border-line bg-white/[0.02] p-4">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <div className="mt-2 space-y-2 text-xs leading-5 text-mut">{children}</div>
    </div>
  )
}

function Command({ children }: { children: string }) {
  return <pre className="mt-2 overflow-x-auto rounded-sm border border-line bg-black/30 p-3 font-mono text-[11px] leading-5 text-ink">{children}</pre>
}

export function InstallGuide() {
  return (
    <main className="min-h-screen bg-mist text-ink px-5 py-10">
      <section className="mx-auto w-full max-w-3xl">
        <p className="hud-label">FindMnemo · install and recovery</p>
        <h1 className="mt-3 text-3xl font-semibold">Get the local companion running</h1>
        <p className="mt-3 text-sm leading-6 text-mut">
          FindMnemo keeps email access, local AI activity, project files, and credentials on this computer. The hosted page only talks to a companion
          listening on <span className="font-mono text-ink">{COMPANION_ORIGIN}</span>; it can never install or start software for you.
        </p>

        <h2 className="mt-8 text-lg font-semibold">Already installed but nothing is answering</h2>
        <p className="mt-2 text-sm leading-6 text-mut">
          If FindMnemo has connected from this browser before, the companion is installed and the problem is that it is not currently listening. Work
          through these in order — they cover every failure mode we have actually observed.
        </p>
        <div className="mt-4 grid gap-3">
          <Step title="1. The companion was never started this session">
            <p>Closing the FindMnemo window or signing out stops the companion. Open FindMnemo from the Start menu and choose Start, then retry the connection.</p>
          </Step>
          <Step title="2. Port 3210 is already in use">
            <p>Another process holding the port prevents the companion from binding. Check it in PowerShell and stop the conflicting process:</p>
            <Command>{'Get-NetTCPConnection -LocalPort 3210 -State Listen |\n  Select-Object OwningProcess |\n  ForEach-Object { Get-Process -Id $_.OwningProcess }'}</Command>
          </Step>
          <Step title="3. The Windows firewall prompt was dismissed or denied">
            <p>
              The first start shows a Windows Defender Firewall prompt. If it was dismissed or denied, loopback traffic can be blocked. Open Windows
              Security → Firewall &amp; network protection → Allow an app through firewall, find FindMnemo, and allow it on Private networks. FindMnemo
              only needs loopback; it does not need a public-network rule.
            </p>
          </Step>
          <Step title="4. Antivirus quarantined the companion">
            <p>
              Because the preview binary is unsigned, some antivirus products quarantine it silently. Check your antivirus quarantine or protection
              history for FindMnemo, restore the file, and add an exclusion for the install directory rather than disabling protection.
            </p>
          </Step>
          <Step title="5. Still nothing">
            <p>
              Open <span className="font-mono text-ink">http://{COMPANION_ORIGIN}/app</span> directly. If that also fails, the companion process is not
              running at all — return to step 1. If it loads there but not here, the hosted page was blocked from reaching loopback; use the local page.
            </p>
          </Step>
        </div>

        <h2 className="mt-10 text-lg font-semibold">Installing for the first time</h2>
        <p className="mt-2 text-sm leading-6 text-mut">
          There is no signed FindMnemo binary in public releases yet, so there is no download link and no published checksum to verify against. Do not
          install a FindMnemo build obtained from anywhere other than the source repository below — an unofficial &ldquo;FindMnemo&rdquo; installer is
          not ours. Until a signed release with a tag, SHA-256 checksum, and provenance record exists, use one of the two local paths.
        </p>
        <div className="mt-4 grid gap-3">
          <Step title="Option A — run the companion from source">
            <p>Install Node.js 24 LTS and Git, clone the repository, then run in PowerShell:</p>
            <Command>{'npm ci\nnpm run setup:check\nnpm run build:source\nnpm run verify:source\nnpm run start:companion'}</Command>
            <p>Keep the terminal open and return to this page, or visit <span className="font-mono text-ink">http://{COMPANION_ORIGIN}/app</span>. This is a foreground source run, not an installed application.</p>
          </Step>
          <Step title="Option B — build the desktop preview installer">
            <Command>{'npm ci\nnpm run package:desktop'}</Command>
            <p>
              This writes <span className="font-mono text-ink">release-desktop\FindMnemo-Companion-0.1.0-x64.exe</span>. The installer is per-user and
              x64 and needs no administrator rights. Node.js and the checkout are needed to build it, not to use it afterwards.
            </p>
          </Step>
        </div>

        <h2 className="mt-10 text-lg font-semibold">Why Windows warns about this build</h2>
        <p className="mt-2 text-sm leading-6 text-mut">
          The preview installer is <strong className="text-ink">unsigned</strong>. No Authenticode identity is attached to it, so SmartScreen shows an
          &ldquo;unknown publisher&rdquo; or &ldquo;Windows protected your PC&rdquo; warning. That warning is accurate — it means Windows cannot verify
          who produced the file, not that the file has been checked and found safe.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-mut">
          <li>Because you built the installer yourself from the source you cloned, you already know its provenance — that is the verification.</li>
          <li>On the SmartScreen dialog, choose <span className="text-ink">More info</span> and confirm the filename matches the artifact you just built before choosing <span className="text-ink">Run anyway</span>.</li>
          <li>Do not turn off SmartScreen, antivirus, or UAC. Allowing one known file is enough; disabling the control is not.</li>
          <li>Installation is per-user and needs no administrator rights. Operational data stays under <span className="font-mono text-ink">%LOCALAPPDATA%\FindMnemo</span>.</li>
        </ul>

        <h2 className="mt-10 text-lg font-semibold">Starting the companion</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-mut">
          <li>Open FindMnemo from the Start menu (or keep the <span className="font-mono text-ink">npm run start:companion</span> terminal open).</li>
          <li>Accept the Windows firewall prompt for private networks on the first run.</li>
          <li>Return to <a href="/app" className="text-sync underline underline-offset-2">the operational workspace</a> and choose Retry connection.</li>
          <li>Enter the one-time pairing code shown in the FindMnemo window if you are asked for it. It works once and expires after five minutes.</li>
        </ol>

        <div className="mt-10 flex flex-wrap gap-3">
          <a href="/app" className="rounded-sm bg-sync px-4 py-2 text-sm font-semibold text-chrome">Back to the workspace</a>
          <a href={`http://${COMPANION_ORIGIN}/app`} className="rounded-sm border border-line px-4 py-2 text-sm text-ink hover:border-sync/60">Open local app (requires companion running)</a>
          <a href={SOURCE_REPOSITORY} target="_blank" rel="noreferrer" className="rounded-sm border border-line px-4 py-2 text-sm text-ink hover:border-sync/60">Source repository</a>
        </div>
      </section>
    </main>
  )
}
