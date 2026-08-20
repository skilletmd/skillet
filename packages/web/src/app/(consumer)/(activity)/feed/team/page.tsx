import { redirect } from 'next/navigation'

// /feed/team with no slug isn't a real view — send people to their default feed.
// (Team tabs always link to /feed/team/<slug>.)
export default function FeedTeamIndex() {
  redirect('/feed')
}
