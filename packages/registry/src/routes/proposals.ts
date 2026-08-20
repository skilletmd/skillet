// Proposal lifecycle: propose/list/detail/decide API.
//
// A proposal is an untrusted change bundle that enters `pending` and must be
// explicitly approved by the skill owner before a version is minted. The same
// signature verification and scan machinery used at publish time runs at
// both propose and approve time. It is impossible to publish a proposal that
// fails either gate.
//
// Allowed proposers (v1): skill owner or same-kit teammate.
// Third-party contributors (non-kit) are deferred to v2.
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from '../db/sqlite-handle.js';
import { BundleError, type BundleFiles, canonicalContentHash, decodeBundle, isBundleSignatureV2, stripSkilletBackupPaths, validateBundle } from '@skillet/protocol';
import { tryToSkillId } from '@skillet/protocol/skill-id';
import { blobHash, getPrimaryAuthorKeyPrisma, newId } from '../db/index.js';
import { type Signature } from '../auth/signature.js';
import { resolveAndVerifySignerPrisma } from '../auth/delegation.js';
import { requireScope, requireSession } from '../auth/middleware.js';
import { userHasVerifiedEmailPrisma } from '../auth/identities.js';
import { secretsBlockingScan, runScan, runScanForProposalPrisma, resolveScanCachedPrisma, DETECTOR_CORPUS_VERSION } from '../scanner/index.js'
import { isTextFile, decodeText } from '../scanner/text-files.js'
import { renderUnifiedDiff } from '../lib/diff.js'
import { extractNameFromSkillMd, extractFrontmatterYaml, parseNameFromYaml } from '../skill-frontmatter.js'
import { bumpAttentionForProposalRecipientsPrisma } from '../lib/attention.js'
import { canManageSkillPrisma } from '../lib/org-access.js'
import type { BlobStore } from '../blob-store/types.js'
import { loadBundleFromManifest, putFileBlobs } from '../blob-store/index.js'
import { classifyVersionBumpPrisma, deriveVersionLabelPrisma } from '../version-label.js'
import { baselineSkillDecisionPrisma } from './approvals.js'
import { runPrismaTransaction } from '../db/prisma-client.js'
import {
  canProposeToSkillPrisma,
  createProposalPrisma,
  findProposalAuthorKeyPrisma,
  findProposalPrisma,
  findProposalSkillPrisma,
  getProposalScanPrisma,
  listProposalFilesPrisma,
  listProposalsForSkillPrisma,
  listVersionFilesPrisma,
  updateProposalDecisionPrisma,
  updateProposalScanPrisma,
} from '../lib/proposal-access.js'
// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------
interface SkillAuthorParams {
    author: string;
    slug: string;
}
interface ProposalParams extends SkillAuthorParams {
    proposalId: string;
}
interface ProposeBody {
    files?: BundleFiles;
    base_hash?: string | null;
    signature?: Signature;
    metadata?: Record<string, unknown>;
}
interface DecideBody {
    decision?: 'approve' | 'request_changes' | 'reject';
    note?: string;
    // Required for decision === 'approve': the owner's Ed25519 signature over the
    // proposed_hash. The minted skill_versions row carries this signature, not the
    // proposer's. Ensures the published artifact is always owner-key-signed (v1 constraint;
    // cross-author signing is v2). CTO decision (2026-06-13).
    signature?: Signature;
}
interface SkillRow {
    id: string;
    latest_hash: string | null;
    author_id: string;
}
interface ProposalRow {
    id: string;
    skill_id: string;
    base_hash: string | null;
    proposed_hash: string;
    state: string;
    proposer_author_id: string;
    signature_alg: string | null;
    signature_key_id: string | null;
    signature_b64: string | null;
    author_key_id: string | null;
    created_at: number;
    decided_by: string | null;
    decided_at: number | null;
    decision_note: string | null;
}
/**
 * The decision-authorization gate, composed once so the GET detail's
 * `can_decide` can never drift from what POST /decision enforces piecewise:
 * handle claimed (403 handle_not_claimed), canManageSkill (403 owner_only),
 * verified email (requireScope('publish') preHandler, 403
 * account_verification_required). Per-action invariants (proposer can't
 * approve their own proposal, approve's signature requirement) are
 * deliberately outside this gate.
 */
async function canDecideProposal(skillId: string, principal: {
    user_id: string;
    handle: string | null;
}, prisma: PrismaClient): Promise<boolean> {
    return (principal.handle != null &&
        (await canManageSkillPrisma(prisma, skillId, principal.user_id)) &&
        (await userHasVerifiedEmailPrisma(prisma, principal.user_id)));
}
// ---------------------------------------------------------------------------
// Graded diff helper
// ---------------------------------------------------------------------------
interface FileDiff {
    path: string;
    status: 'added' | 'removed' | 'modified' | 'unchanged';
    diff: string | null;
    binary: boolean;
    // Set when the file pair exceeds the diff size guard (lib/diff.ts): the LCS
    // table is never allocated, so `diff` stays null instead of risking an OOM.
    tooLarge?: boolean;
}
async function getBytesForHash(blobStore: BlobStore, blobHashStr: string): Promise<Uint8Array | null> {
    const bytes = await blobStore.get(blobHashStr);
    return bytes ?? null;
}
/**
 * Compute a graded diff between a base version's files and a proposal's files.
 * Text files get a unified diff; binary files are flagged without content.
 * MySQL/Prisma only after U5.
 */
async function computeGradedDiff(
  blobStore: BlobStore,
  baseHash: string | null,
  proposalId: string,
  prisma: PrismaClient,
  skillId: string,
): Promise<FileDiff[]> {
  const baseFiles = new Map<string, string>()
  if (baseHash) {
    const rows = await listVersionFilesPrisma(prisma, skillId, baseHash)
    for (const row of rows) {
      baseFiles.set(row.path, row.blob_hash)
    }
  }

  const proposalFiles = new Map<string, string>()
  const proposalRows = await listProposalFilesPrisma(prisma, proposalId)
  for (const row of proposalRows) {
    proposalFiles.set(row.path, row.blob_hash)
  }

  const allPaths = [...new Set([...baseFiles.keys(), ...proposalFiles.keys()])].sort()
  const result: FileDiff[] = []

  for (const path of allPaths) {
    const baseBlob = baseFiles.get(path) ?? null
    const proposalBlob = proposalFiles.get(path) ?? null

    if (baseBlob === proposalBlob) {
      result.push({ path, status: 'unchanged', diff: null, binary: false })
      continue
    }

    const status: FileDiff['status'] = !baseBlob ? 'added' : !proposalBlob ? 'removed' : 'modified'
    const refBytes = await getBytesForHash(blobStore, (proposalBlob ?? baseBlob)!)
    const isBinary = !refBytes || !isTextFile(path, refBytes)

    if (isBinary) {
      result.push({ path, status, diff: null, binary: true })
      continue
    }

    const baseBytes = baseBlob ? await getBytesForHash(blobStore, baseBlob) : null
    const proposalBytes = proposalBlob ? await getBytesForHash(blobStore, proposalBlob) : null
    const baseText = baseBytes ? decodeText(baseBytes) : ''
    const proposalText = proposalBytes ? decodeText(proposalBytes) : ''

    const rendered = renderUnifiedDiff(
      path,
      baseBlob ?? 'empty',
      proposalBlob ?? 'empty',
      baseText,
      proposalText,
    )

    if (rendered.tooLarge) {
      result.push({ path, status, diff: null, binary: false, tooLarge: true })
      continue
    }

    result.push({ path, status, diff: rendered.diff || null, binary: false })
  }

  return result
}
// ---------------------------------------------------------------------------
// Mint gate
// ---------------------------------------------------------------------------
type MintResult = {
    ok: true;
    versionHash: string;
} | {
    ok: false;
    status: number;
    error: string;
    message: string;
    extra?: Record<string, unknown>;
};
/** Prisma twin of mintFromProposal for MySQL approve. */
async function mintFromProposalPrisma(prisma: PrismaClient, blobStore: BlobStore, proposal: ProposalRow, skill: SkillRow, approverHandle: string, ownerSignature: Signature, note: string | null, decidedAt: number): Promise<MintResult> {
    const freshSkill = await prisma.skills.findUnique({
        where: { id: skill.id },
        select: { latest_hash: true },
    });
    if (freshSkill?.latest_hash !== proposal.base_hash) {
        return {
            ok: false,
            status: 409,
            error: 'base_stale',
            message: "Proposal base_hash no longer matches the skill's current latest_hash. " +
                'Re-propose from the current version.',
        };
    }
    const proposalFileRows = await prisma.proposal_files.findMany({
        where: { proposal_id: proposal.id },
        select: { path: true, blob_hash: true },
    });
    if (proposalFileRows.length === 0) {
        return { ok: false, status: 500, error: 'corrupt_proposal', message: 'No files found for proposal' };
    }
    const bundleMap = await loadBundleFromManifest(blobStore, proposalFileRows);
    if (!bundleMap) {
        return {
            ok: false,
            status: 500,
            error: 'corrupt_proposal',
            message: 'One or more proposal blobs are missing from storage',
        };
    }
    const secretHit = secretsBlockingScan(bundleMap);
    if (secretHit) {
        return {
            ok: false,
            status: 422,
            error: 'scan_blocked',
            message: 'Approve blocked: a high-confidence credential pattern was detected in the proposal bundle. ' +
                'Remove the secret and re-propose.',
            extra: {
                finding: {
                    category: secretHit.category,
                    confidence: secretHit.confidence,
                    file: secretHit.file,
                    lineStart: secretHit.lineStart,
                    lineEnd: secretHit.lineEnd,
                    why: secretHit.why,
                },
            },
        };
    }
    const proposerRow = await prisma.users.findFirst({
        where: { handle: proposal.proposer_author_id },
        select: { id: true },
    });
    const storedSig: Signature | null = proposal.signature_alg && proposal.signature_key_id && proposal.signature_b64
        ? {
            alg: proposal.signature_alg as 'ed25519',
            key_id: proposal.signature_key_id,
            sig: proposal.signature_b64,
        }
        : null;
    const proposerSigCheck = await resolveAndVerifySignerPrisma(prisma, proposerRow?.id ?? '', proposal.proposed_hash, storedSig, 'propose');
    if ('code' in proposerSigCheck) {
        return {
            ok: false,
            status: 422,
            error: proposerSigCheck.code,
            message: `Approve blocked: proposer signature re-verification failed — ${proposerSigCheck.message}`,
        };
    }
    const ownerRow = await prisma.users.findFirst({
        where: { handle: approverHandle },
        select: { id: true },
    });
    const ownerPrimaryKey = ownerRow
        ? await getPrimaryAuthorKeyPrisma(prisma, ownerRow.id)
        : null;
    if (!ownerPrimaryKey) {
        return {
            ok: false,
            status: 422,
            error: 'owner_key_not_found',
            message: 'Owner has no registered primary author key. Claim a key before approving proposals.',
        };
    }
    const ownerSigCheck = await resolveAndVerifySignerPrisma(prisma, ownerRow?.id ?? '', proposal.proposed_hash, ownerSignature, 'approve');
    if ('code' in ownerSigCheck) {
        return {
            ok: false,
            status: 422,
            error: ownerSigCheck.code,
            message: `Approve blocked: owner signature verification failed — ${ownerSigCheck.message}`,
        };
    }
    const ownerPrimaryKeyId = ownerSigCheck.primary_key_id;
    const ownerDelegationJson = ownerSigCheck.signed_delegation
        ? JSON.stringify(ownerSigCheck.signed_delegation)
        : null;
    const scanResult = runScan(bundleMap);
    const now = Math.floor(Date.now() / 1000);
    if (scanResult.status === 'quarantined') {
        await prisma.proposal_scans.upsert({
            where: { proposal_id: proposal.id },
            create: {
                proposal_id: proposal.id,
                status: scanResult.status,
                findings_json: JSON.stringify({ findings: scanResult.findings, summary: scanResult.summary }),
                scanned_at: now,
            },
            update: {
                status: scanResult.status,
                findings_json: JSON.stringify({ findings: scanResult.findings, summary: scanResult.summary }),
                scanned_at: now,
            },
        });
        return {
            ok: false,
            status: 422,
            error: 'scan_quarantined',
            message: 'Approve blocked: harm scan returned quarantined. Remove the flagged content and re-propose.',
            extra: { scan: { status: scanResult.status, summary: scanResult.summary } },
        };
    }
    const versionHash = proposal.proposed_hash;
    const existingVersion = await prisma.skill_versions.findUnique({
        where: {
            skill_id_hash: { skill_id: proposal.skill_id, hash: versionHash },
        },
        select: { hash: true },
    });
    if (existingVersion) {
        await prisma.skill_proposals.update({
            where: { id: proposal.id },
            data: {
                state: 'approved',
                decided_by: approverHandle,
                decided_at: decidedAt,
                decision_note: note,
            },
        });
        return { ok: true, versionHash };
    }
    const nextSkillMdBytes = bundleMap.get('SKILL.md');
    const bumpKind = await classifyVersionBumpPrisma(prisma, {
        skillId: proposal.skill_id,
        baseHash: freshSkill?.latest_hash ?? null,
        nextFiles: new Map(proposalFileRows.map((r) => [r.path, r.blob_hash])),
        nextSkillMd: nextSkillMdBytes ? Buffer.from(nextSkillMdBytes).toString('utf8') : null,
        readBlob: (hash) => blobStore.get(hash),
    });
    await runPrismaTransaction(prisma, async (tx) => {
        const { label } = await deriveVersionLabelPrisma(tx, proposal.skill_id, bumpKind);
        await tx.skill_versions.create({
            data: {
                hash: versionHash,
                skill_id: proposal.skill_id,
                signature_alg: ownerSignature.alg,
                signature_key_id: ownerSignature.key_id,
                signature_b64: ownerSignature.sig,
                author_key_id: ownerPrimaryKeyId,
                sig_version: isBundleSignatureV2(ownerSignature) ? 2 : 1,
                delegation_json: ownerDelegationJson,
                major: label.major,
                minor: label.minor,
                patch: label.patch,
                metadata_json: JSON.stringify({
                    _proposal_id: proposal.id,
                    proposed_by: proposal.proposer_author_id,
                    changelog: `Proposed by @${proposal.proposer_author_id}` +
                        (note?.trim() ? ` — ${note.trim()}` : ''),
                }),
                published_by: approverHandle,
            },
        });
        await tx.skill_version_files.createMany({
            data: proposalFileRows.map((row) => ({
                skill_id: proposal.skill_id,
                version_hash: versionHash,
                path: row.path,
                blob_hash: row.blob_hash,
            })),
            skipDuplicates: true,
        });
        await tx.skill_version_provenance.createMany({
            data: [
                {
                    skill_id: proposal.skill_id,
                    version_hash: versionHash,
                    proposed_by: proposal.proposer_author_id,
                    approved_by: approverHandle,
                    proposal_id: proposal.id,
                },
            ],
            skipDuplicates: true,
        });
        const approverSkillId = tryToSkillId(proposal.skill_id);
        if (ownerRow && approverSkillId) {
            await baselineSkillDecisionPrisma(tx, ownerRow.id, approverSkillId, versionHash);
        }
        await tx.skills.update({
            where: { id: proposal.skill_id },
            data: { latest_hash: versionHash },
        });
        await tx.skill_version_scans.createMany({
            data: [
                {
                    skill_id: proposal.skill_id,
                    skill_version_id: versionHash,
                    status: scanResult.status,
                    findings_json: JSON.stringify({
                        findings: scanResult.findings ?? [],
                        summary: scanResult.summary,
                    }),
                    scanned_at: now,
                    detector_corpus_version: DETECTOR_CORPUS_VERSION,
                },
            ],
            skipDuplicates: true,
        });
        await tx.skill_proposals.update({
            where: { id: proposal.id },
            data: {
                state: 'approved',
                decided_by: approverHandle,
                decided_at: decidedAt,
                decision_note: note,
            },
        });
        await tx.proposal_scans.upsert({
            where: { proposal_id: proposal.id },
            create: {
                proposal_id: proposal.id,
                status: scanResult.status,
                findings_json: JSON.stringify(scanResult.findings ?? []),
                scanned_at: now,
            },
            update: {
                status: scanResult.status,
                findings_json: JSON.stringify(scanResult.findings ?? []),
                scanned_at: now,
            },
        });
    });
    return { ok: true, versionHash };
}
export interface ProposalRoutesOptions {
    /** When true, the async post-propose harm scan runs synchronously (for tests). */
    scanSync?: boolean;
    prisma?: PrismaClient;
}
function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
    if (!prisma) {
        throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL');
    }
    return prisma;
}
function prismaForProposalRoutes(app: FastifyInstance, explicit?: PrismaClient): PrismaClient {
    return requirePrisma(explicit ?? (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined));
}
function proposalScanResponse(row: {
    status: string;
    findings_json: string;
} | null): {
    status: string;
    findings_summary?: unknown;
} {
    if (!row)
        return { status: 'pending' };
    try {
        const parsed = JSON.parse(row.findings_json) as unknown;
        if (parsed && typeof parsed === 'object' && 'summary' in parsed) {
            return {
                status: row.status,
                findings_summary: (parsed as {
                    summary: unknown;
                }).summary,
            };
        }
    }
    catch {
    }
    return { status: row.status };
}
export function registerProposalRoutes(app: FastifyInstance, db: DatabaseSync, blobStore: BlobStore, opts: ProposalRoutesOptions = {}): void {
    const prisma = prismaForProposalRoutes(app, opts.prisma);
    const scheduleProposalScan = async (proposalId: string, bundle?: Map<string, Uint8Array>): Promise<void> => {
        try {
            if (bundle) {
                const resolved = await resolveScanCachedPrisma(prisma, bundle);
                await updateProposalScanPrisma(prisma, proposalId, resolved.result.status, resolved.findingsJson, Math.floor(Date.now() / 1000));
            }
            else {
                await runScanForProposalPrisma(prisma, blobStore, proposalId);
            }
        }
        catch (err) {
            app.log.error({ err, proposalId }, 'proposal scan run failed');
        }
    };
    // --------------------------------------------------------------------------
    // POST /skills/:author/:slug/proposals
    //
    // Create a proposal. Runs secretsBlockingScan + signature verification at
    // propose time. Does NOT touch skills.latest_hash.
    // Auth: requireScope('publish') — session + 2FA required.
    // Proposer must be skill owner or same-kit teammate; third-party → 403.
    // --------------------------------------------------------------------------
    app.post<{
        Params: SkillAuthorParams;
        Body: ProposeBody;
    }>('/skills/:author/:slug/proposals', { preHandler: [requireScope('publish')], bodyLimit: 10 * 1024 * 1024 }, async (req, reply) => {
        const { author, slug } = req.params;
        const { files, base_hash, signature } = req.body ?? {};
        const skillId = tryToSkillId(`${author}/${slug}`);
        if (!skillId) {
            return reply.status(404).send({ error: 'skill_not_found' });
        }
        if (!files || typeof files !== 'object') {
            return reply.status(400).send({ error: 'files_required' });
        }
        const principal = req.principal as {
            class: 'session';
            user_id: string;
            handle: string | null;
        };
        if (principal.handle == null) {
            return reply.status(403).send({ error: 'handle_not_claimed' });
        }
        const skill = await findProposalSkillPrisma(prisma, skillId);
        if (!skill) {
            return reply.status(404).send({ error: 'skill_not_found' });
        }
        // Invariant 5: authorization check before any scan/write.
        const mayPropose = await canProposeToSkillPrisma(prisma, skillId, principal.user_id);
        if (!mayPropose) {
            return reply.status(403).send({
                error: 'not_authorized',
                message: 'Only the skill owner, a same-kit teammate, or an org member may propose changes. ' +
                    'Third-party contributions are deferred to v2.',
            });
        }
        let bundle;
        try {
            bundle = stripSkilletBackupPaths(decodeBundle(files));
            validateBundle(bundle);
        }
        catch (err) {
            if (err instanceof BundleError) {
                return reply.status(422).send({ error: err.code, message: err.message });
            }
            throw err;
        }
        // Invariant 1+6: secretsBlockingScan before any DB write.
        const secretHit = secretsBlockingScan(bundle);
        if (secretHit) {
            // Singular `finding` is this route's established wire shape — the web
            // propose form (create-proposal.ts) reads `errBody.finding`. The core CLI
            // client normalizes `finding`→`findings[]`, so both shapes are handled
            // without breaking the web consumer.
            return reply.status(422).send({
                error: 'scan_blocked',
                message: 'Proposal blocked: a high-confidence credential pattern was detected. ' +
                    'Remove the secret and re-propose.',
                finding: {
                    category: secretHit.category,
                    confidence: secretHit.confidence,
                    file: secretHit.file,
                    lineStart: secretHit.lineStart,
                    lineEnd: secretHit.lineEnd,
                    why: secretHit.why,
                },
            });
        }
        // Identity lock: a proposal may change the skill's contents but not its
        // name. The display name is the owner's to set — only they can rename it,
        // through Edit. Compare the proposed SKILL.md `name:` against the current
        // published version's and reject a mismatch before any write.
        if (skill.latest_hash) {
            const proposedName = extractNameFromSkillMd(bundle);
            const currentFile = (await listVersionFilesPrisma(prisma, skillId, skill.latest_hash))
                .find((file) => file.path === 'SKILL.md');
            if (currentFile) {
                const currentBytes = await getBytesForHash(blobStore, currentFile.blob_hash);
                const currentYaml = currentBytes
                    ? extractFrontmatterYaml(Buffer.from(currentBytes).toString('utf8'))
                    : null;
                const currentName = currentYaml ? parseNameFromYaml(currentYaml) : null;
                const proposedBytes = bundle.get('SKILL.md');
                const proposedYaml = proposedBytes != null
                    ? extractFrontmatterYaml(Buffer.from(proposedBytes).toString('utf8'))
                    : null;
                const proposedHasNameKey = proposedYaml != null && /^name:/m.test(proposedYaml);
                if (currentName != null) {
                    if (proposedName == null && proposedHasNameKey) {
                        return reply.status(422).send({
                            error: 'name_locked',
                            message: `A proposal can't rename the skill. "${currentName}" is owned by the skill ` +
                                'owner — change anything else, but keep the name as is.',
                        });
                    }
                    if (proposedName != null && proposedName !== currentName) {
                        return reply.status(422).send({
                            error: 'name_locked',
                            message: `A proposal can't rename the skill. "${currentName}" is owned by the skill ` +
                                'owner — change anything else, but keep the name as is.',
                        });
                    }
                }
            }
        }
        const proposedHash = canonicalContentHash(bundle);
        // Invariant 1+5: verify signature against the proposer's authority.
        // proposer_author_id is derived from the authenticated principal's handle —
        // never from a body field — so a leaked token cannot spoof authorship.
        // resolveAndVerifySigner accepts the primary key OR a delegated
        // device key (scope 'propose') chaining to the proposer's primary key.
        const sigCheck = await resolveAndVerifySignerPrisma(prisma, principal.user_id, proposedHash, signature, 'propose');
        if ('code' in sigCheck) {
            return reply.status(422).send({ error: sigCheck.code, message: sigCheck.message });
        }
        const verifiedSig = signature as Signature;
        const fileBlobs: Array<{
            path: string;
            hash: string;
            bytes: Uint8Array;
        }> = [];
        for (const [path, bytes] of bundle) {
            fileBlobs.push({ path, hash: blobHash(bytes), bytes });
        }
        const proposalId = newId();
        // putFileBlobs persists each blob through the store, which durably records
        // it per backend (inline bytes in dev/memory so proposal files survive a
        // restart; R2 in prod). The old explicit putBlobMetaPrisma('memory') loop
        // here was redundant — and, post-durability-fix, would try to write a
        // metadata-only row that the store's real write already covers.
        await putFileBlobs(blobStore, fileBlobs);
        await createProposalPrisma(prisma, {
            proposalId,
            skillId,
            baseHash: base_hash ?? null,
            proposedHash,
            proposerHandle: principal.handle,
            signatureAlg: verifiedSig.alg,
            signatureKeyId: verifiedSig.key_id,
            signatureB64: verifiedSig.sig,
            authorKeyId: sigCheck.primary_key_id,
            files: fileBlobs.map((file) => ({ path: file.path, blobHash: file.hash })),
        });
        if (opts.scanSync) {
            await scheduleProposalScan(proposalId, bundle);
        }
        else {
            setImmediate(() => {
                void scheduleProposalScan(proposalId, bundle);
            });
        }
        await bumpAttentionForProposalRecipientsPrisma(prisma, skillId, principal.handle);
        return reply.status(201).send({
            proposal_id: proposalId,
            skill_id: skillId,
            proposed_hash: proposedHash,
            state: 'pending',
            proposal_url: `/api/v1/skills/${author}/${slug}/proposals/${proposalId}`,
            scan: { status: 'pending' as const },
        });
    });
    // --------------------------------------------------------------------------
    // GET /skills/:author/:slug/proposals
    //
    // List proposals. Auth: session required; same gate as proposing
    // (canProposeToSkill) — the owner, an org member for org-owned skills, or a
    // teammate who shares a team with the owner. Kit membership grants nothing.
    // --------------------------------------------------------------------------
    app.get<{
        Params: SkillAuthorParams;
    }>('/skills/:author/:slug/proposals', { preHandler: [requireSession] }, async (req, reply) => {
        const { author, slug } = req.params;
        const skillId = tryToSkillId(`${author}/${slug}`);
        if (!skillId) {
            return reply.status(404).send({ error: 'skill_not_found' });
        }
        const skill = await findProposalSkillPrisma(prisma, skillId);
        if (!skill) {
            return reply.status(404).send({ error: 'skill_not_found' });
        }
        const principal = req.principal as {
            user_id: string;
        };
        const mayPropose = await canProposeToSkillPrisma(prisma, skillId, principal.user_id);
        if (!mayPropose) {
            return reply.status(403).send({ error: 'not_authorized' });
        }
        const rows = await listProposalsForSkillPrisma(prisma, skillId);
        return reply.status(200).send({
            proposals: await Promise.all(rows.map(async (p) => {
                const scan = proposalScanResponse(await getProposalScanPrisma(prisma, p.id));
                return {
                    proposal_id: p.id,
                    skill_id: p.skill_id,
                    base_hash: p.base_hash,
                    proposed_hash: p.proposed_hash,
                    state: p.state,
                    proposer: p.proposer_author_id,
                    created_at: p.created_at,
                    decided_by: p.decided_by,
                    decided_at: p.decided_at,
                    decision_note: p.decision_note,
                    proposal_url: `/api/v1/skills/${author}/${slug}/proposals/${p.id}`,
                    scan,
                };
            })),
        });
    });
    // --------------------------------------------------------------------------
    // GET /skills/:author/:slug/proposals/:proposalId
    //
    // Proposal detail: graded diff, scan verdict, proposer identity, state.
    // Auth: session required, owner or kit teammate only.
    // --------------------------------------------------------------------------
    app.get<{
        Params: ProposalParams;
    }>('/skills/:author/:slug/proposals/:proposalId', { preHandler: [requireSession] }, async (req, reply) => {
        const { author, slug, proposalId } = req.params;
        const skillId = tryToSkillId(`${author}/${slug}`);
        if (!skillId) {
            return reply.status(404).send({ error: 'skill_not_found' });
        }
        const skill = await findProposalSkillPrisma(prisma, skillId);
        if (!skill) {
            return reply.status(404).send({ error: 'skill_not_found' });
        }
        const principal = req.principal as {
            user_id: string;
            handle: string | null;
        };
        const mayPropose = await canProposeToSkillPrisma(prisma, skillId, principal.user_id);
        if (!mayPropose) {
            return reply.status(403).send({ error: 'not_authorized' });
        }
        const proposal = await findProposalPrisma(prisma, proposalId, skillId);
        if (!proposal) {
            return reply.status(404).send({ error: 'proposal_not_found' });
        }
        const can_decide = await canDecideProposal(skillId, principal, prisma);
        const proposerPub = await findProposalAuthorKeyPrisma(prisma, proposal.proposer_author_id);
        const scan = proposalScanResponse(await getProposalScanPrisma(prisma, proposalId));
        const diff = await computeGradedDiff(
          blobStore,
          proposal.base_hash,
          proposalId,
          prisma,
          skillId,
        )
        // Signal if the skill advanced past the proposal's base since propose time.
        // Mirrors the stale-base guard in mintFromProposal so the owner sees the
        // problem before attempting to approve (which would 409 base_stale).
        const base_stale = skill.latest_hash !== proposal.base_hash;
        return reply.status(200).send({
            proposal_id: proposal.id,
            skill_id: proposal.skill_id,
            base_hash: proposal.base_hash,
            proposed_hash: proposal.proposed_hash,
            state: proposal.state,
            base_stale,
            can_decide,
            proposer: {
                handle: proposal.proposer_author_id,
                author_key_id: proposerPub.author_key_id,
                author_public_key: proposerPub.author_public_key,
            },
            signature: proposal.signature_alg && proposal.signature_key_id && proposal.signature_b64
                ? {
                    alg: proposal.signature_alg,
                    key_id: proposal.signature_key_id,
                    sig: proposal.signature_b64,
                }
                : null,
            created_at: proposal.created_at,
            decided_by: proposal.decided_by,
            decided_at: proposal.decided_at,
            decision_note: proposal.decision_note,
            scan,
            diff,
        });
    });
    // --------------------------------------------------------------------------
    // POST /skills/:author/:slug/proposals/:proposalId/decision
    //
    // Owner-only. approve calls mintFromProposal() — the single gate that
    // re-verifies sig + re-runs harm scan + mints a version atomically.
    // request_changes / reject → set state, no version minted.
    // --------------------------------------------------------------------------
    app.post<{
        Params: ProposalParams;
        Body: DecideBody;
    }>('/skills/:author/:slug/proposals/:proposalId/decision', { preHandler: [requireScope('publish')] }, async (req, reply) => {
        const { author, slug, proposalId } = req.params;
        const { decision, note, signature: ownerSignatureInput } = req.body ?? {};
        const skillId = tryToSkillId(`${author}/${slug}`);
        if (!skillId) {
            return reply.status(404).send({ error: 'skill_not_found' });
        }
        if (decision !== 'approve' && decision !== 'request_changes' && decision !== 'reject') {
            return reply.status(400).send({
                error: 'invalid_decision',
                message: 'decision must be one of: approve, request_changes, reject',
            });
        }
        const principal = req.principal as {
            class: 'session';
            user_id: string;
            handle: string | null;
        };
        // Piecewise enforcement of canDecideProposal (distinct error codes per
        // leg; the verified-email leg is the requireScope('publish') preHandler
        // above). Change that helper and these checks together.
        if (principal.handle == null) {
            return reply.status(403).send({ error: 'handle_not_claimed' });
        }
        const skill = await findProposalSkillPrisma(prisma, skillId);
        if (!skill) {
            return reply.status(404).send({ error: 'skill_not_found' });
        }
        const mayManage = await canManageSkillPrisma(prisma, skillId, principal.user_id);
        if (!mayManage) {
            return reply.status(403).send({ error: 'owner_only' });
        }
        const proposal = await findProposalPrisma(prisma, proposalId, skillId);
        if (!proposal) {
            return reply.status(404).send({ error: 'proposal_not_found' });
        }
        if (proposal.state !== 'pending') {
            return reply.status(409).send({
                error: 'already_decided',
                message: `Proposal is already in state '${proposal.state}'.`,
            });
        }
        // Invariant 4: proposer cannot approve their own proposal.
        if (decision === 'approve' && principal.handle === proposal.proposer_author_id) {
            return reply.status(403).send({
                error: 'proposer_cannot_approve',
                message: 'The proposer cannot approve their own proposal.',
            });
        }
        // v1 owner-key-only: approve requires the owner's signature over proposed_hash.
        // Checked after auth/identity guards so non-owners get the right error first.
        if (decision === 'approve' && !ownerSignatureInput) {
            return reply.status(400).send({
                error: 'signature_required',
                message: 'approve requires a signature field: the owner must sign the proposed_hash with their author key. ' +
                    'This ensures the published artifact is always owner-key-signed.',
            });
        }
        const decidedAt = Math.floor(Date.now() / 1000);
        if (decision === 'request_changes' || decision === 'reject') {
            // Map API decision values to the DB state enum values.
            const newState = decision === 'reject' ? 'rejected' : 'changes_requested';
            await updateProposalDecisionPrisma(prisma, proposalId, newState, principal.handle, decidedAt, note ?? null);
            return reply.status(200).send({
                proposal_id: proposalId,
                state: newState,
                decided_by: principal.handle,
                decided_at: decidedAt,
            });
        }
        const result = await mintFromProposalPrisma(prisma, blobStore, proposal, skill, principal.handle, ownerSignatureInput as Signature, note ?? null, decidedAt);
        if (!result.ok) {
            return reply.status(result.status).send({
                error: result.error,
                message: result.message,
                ...(result.extra ?? {}),
            });
        }
        return reply.status(200).send({
            proposal_id: proposalId,
            state: 'approved',
            version_hash: result.versionHash,
            version_url: `/api/v1/skills/${author}/${slug}/versions/${result.versionHash}`,
            decided_by: principal.handle,
            decided_at: decidedAt,
        });
    });
}
