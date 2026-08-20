import { MarkdownContent } from '@/components/markdown-content'
import { FrontmatterCard } from '@/components/skills/frontmatter-card'
import { FilesSection, DocumentSection } from '@/components/skills/files-section'
import { Panel } from '@/components/ui/panel'
import type { SkillBundleSummary } from '@/lib/skill-bundle-content'
import { bundleImageResolver, type SkillBundleAssets } from '@/lib/bundle-images'
import { SKILL_ENTRYPOINT } from '@/lib/skill-bundle'

/**
 * The skill's content viewer: inline preview + full-screen expand, in one call.
 * This server component decides single- vs multi-file and hands the bundle data
 * to ONE client section (FilesSection/DocumentSection), which builds both the
 * inline and overlay copies client-side — so the file text crosses the RSC
 * boundary once, not once per copy.
 */
export function SkillBundleView({
  bundle,
  author,
  slug,
}: {
  bundle: SkillBundleSummary
  author: string
  slug: string
}) {
  const supportingFiles = bundle.files.filter((f) => f.path !== SKILL_ENTRYPOINT)

  // Everything the viewer needs to build raw-image URLs for this bundle —
  // plain data, since it crosses into the client components below.
  const assets: SkillBundleAssets = {
    author,
    slug,
    versionHash: bundle.versionHash,
    sizes: Object.fromEntries(bundle.files.map((f) => [f.path, f.size])),
  }

  const skillMdBody = bundle.skillMdBody ? (
    <>
      {bundle.frontmatter && <FrontmatterCard yaml={bundle.frontmatter} />}
      <MarkdownContent
        content={bundle.skillMdBody}
        variant="compact"
        resolveImageSrc={bundleImageResolver(assets, SKILL_ENTRYPOINT)}
      />
    </>
  ) : (
    <p className="text-sm text-(--ink-2)">No readable {SKILL_ENTRYPOINT} body in this version.</p>
  )

  // Single-file skill: just the document, with the same Markdown toggle as the
  // multi-file viewer.
  if (supportingFiles.length === 0) {
    return (
      <section aria-label="Skill instructions">
        {bundle.skillMdBody ? (
          <DocumentSection
            source={bundle.skillMdBody}
            frontmatter={bundle.frontmatter}
            author={author}
            slug={slug}
            assets={assets}
          />
        ) : (
          <Panel padding="none" className="skill-document overflow-hidden">
            <div className="border-b border-(--line) px-4 py-2.5 font-mono text-xs text-(--ink-2)">
              {SKILL_ENTRYPOINT}
            </div>
            <div className="px-5 py-5 sm:px-6 sm:py-6">{skillMdBody}</div>
          </Panel>
        )}
      </section>
    )
  }

  // Multi-file skill: one file browser. The window scrolls and is height-capped,
  // so SKILL.md renders in full (no "Show full" collapse). The file count and
  // metadata live in the browser's bottom status bar, not a heading above it.
  return (
    <section aria-label="Skill instructions">
      <FilesSection
        files={bundle.files}
        versionHash={bundle.versionHash}
        skillMdSlot={skillMdBody}
        author={author}
        slug={slug}
        assets={assets}
      />
    </section>
  )
}
