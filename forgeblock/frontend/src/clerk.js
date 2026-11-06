// Microsoft and Google sign-in through Clerk (clerk.com). Clerk's browser
// script is loaded from the app's own Clerk Frontend API only when someone
// clicks a sign-in button, so no npm package is needed. After Clerk signs the
// person in, its session token is exchanged once for a ForgeBlock session
// (backend: POST /api/auth/oauth) and the Clerk session is signed out again.
let loading = null

export function loadClerk(publishableKey, frontendApi) {
  if (window.Clerk?.loaded) return Promise.resolve(window.Clerk)
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = `https://${frontendApi}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`
      s.async = true
      s.crossOrigin = 'anonymous'
      s.setAttribute('data-clerk-publishable-key', publishableKey)
      s.onload = async () => {
        try {
          await window.Clerk.load()
          resolve(window.Clerk)
        } catch (e) {
          reject(e)
        }
      }
      s.onerror = () => reject(new Error('Could not load the sign-in service. Check your internet connection.'))
      document.head.appendChild(s)
    }).catch((e) => {
      loading = null
      throw e
    })
  }
  return loading
}

export async function startClerkSignIn(providers, provider) {
  const clerk = await loadClerk(providers.clerk_publishable_key, providers.clerk_frontend_api)
  if (clerk.user) await clerk.signOut()
  const origin = window.location.origin
  await clerk.client.signIn.authenticateWithRedirect({
    strategy: `oauth_${provider}`,
    redirectUrl: `${origin}/auth/sso-callback`,
    redirectUrlComplete: `${origin}/auth/callback`,
  })
}

const AFTER = '/auth/callback'

// Clerk's OAuth return page: finishes the sign-in (or the first-time sign-up
// of that Google/Microsoft account in Clerk) and goes on to /auth/callback.
export async function finishClerkRedirect(providers) {
  const clerk = await loadClerk(providers.clerk_publishable_key, providers.clerk_frontend_api)
  await clerk.handleRedirectCallback({
    signInForceRedirectUrl: AFTER, signUpForceRedirectUrl: AFTER,
    signInFallbackRedirectUrl: AFTER, signUpFallbackRedirectUrl: AFTER,
    afterSignInUrl: AFTER, afterSignUpUrl: AFTER,
    signInUrl: '/signin', signUpUrl: '/signin',
  })
}

export async function clerkSessionToken(providers) {
  const clerk = await loadClerk(providers.clerk_publishable_key, providers.clerk_frontend_api)
  if (!clerk.session) return null
  return clerk.session.getToken()
}

export async function clerkSignOut() {
  try {
    if (window.Clerk?.user) await window.Clerk.signOut()
  } catch {
    // the ForgeBlock session does not depend on it
  }
}
