import { createPublicClient, http } from "viem";
import { xLayer } from "viem/chains";
import { zettaStreamMedalAbi } from "@/lib/abi";
import {
  ZETTA_STREAM_MEDAL_ADDRESS,
  XLAYER_RPC,
  OKLINK_ADDRESS,
} from "@/lib/addresses";

export const revalidate = 30;

const client = createPublicClient({ chain: xLayer, transport: http(XLAYER_RPC) });

interface MedalEntry {
  tokenId: bigint;
  rotationId: bigint;
  netYieldBps: number;
  mintedAt: bigint;
  owner: `0x${string}`;
  imageDataUri: string;
}

/**
 * Strip the on-chain JSON metadata wrapper to grab the SVG data: URI directly.
 * Tokens are minted with `data:application/json;base64,…` whose decoded JSON has
 * an `image` field that is itself a `data:image/svg+xml;base64,…`.
 */
function extractImage(tokenUri: string): string {
  if (!tokenUri.startsWith("data:application/json;base64,")) return tokenUri;
  try {
    const b64 = tokenUri.slice("data:application/json;base64,".length);
    const json = Buffer.from(b64, "base64").toString("utf8");
    const parsed = JSON.parse(json) as { image?: string };
    return parsed.image ?? "";
  } catch {
    return "";
  }
}

async function fetchMedals(): Promise<MedalEntry[]> {
  if (!ZETTA_STREAM_MEDAL_ADDRESS) return [];
  try {
    const total = (await client.readContract({
      address: ZETTA_STREAM_MEDAL_ADDRESS,
      abi: zettaStreamMedalAbi,
      functionName: "totalSupply",
    })) as bigint;

    const ids = Array.from({ length: Number(total) }, (_, i) => BigInt(i));
    return await Promise.all(
      ids.map(async (id) => {
        const [meta, owner, uri] = await Promise.all([
          client.readContract({
            address: ZETTA_STREAM_MEDAL_ADDRESS,
            abi: zettaStreamMedalAbi,
            functionName: "medals",
            args: [id],
          }) as Promise<readonly [bigint, number, bigint]>,
          client.readContract({
            address: ZETTA_STREAM_MEDAL_ADDRESS,
            abi: zettaStreamMedalAbi,
            functionName: "ownerOf",
            args: [id],
          }) as Promise<`0x${string}`>,
          client.readContract({
            address: ZETTA_STREAM_MEDAL_ADDRESS,
            abi: zettaStreamMedalAbi,
            functionName: "tokenURI",
            args: [id],
          }) as Promise<string>,
        ]);
        return {
          tokenId: id,
          rotationId: meta[0],
          netYieldBps: meta[1],
          mintedAt: meta[2],
          owner,
          imageDataUri: extractImage(uri),
        };
      }),
    );
  } catch {
    return [];
  }
}

export default async function MedalsPage() {
  const medals = await fetchMedals();
  const addrReady = !!ZETTA_STREAM_MEDAL_ADDRESS;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Medal gallery</h1>
          <p className="text-sm text-[rgb(var(--muted))] mt-1">
            One ERC-721 minted per profitable rotation. Metadata + SVG are fully on-chain.
          </p>
        </div>
        <div className="text-xs text-[rgb(var(--muted))] font-mono">
          {addrReady ? (
            <>
              Contract:{" "}
              <a
                className="underline text-[rgb(var(--accent))]"
                href={OKLINK_ADDRESS(ZETTA_STREAM_MEDAL_ADDRESS)}
                target="_blank"
                rel="noreferrer"
              >
                {ZETTA_STREAM_MEDAL_ADDRESS.slice(0, 8)}…{ZETTA_STREAM_MEDAL_ADDRESS.slice(-6)}
              </a>
              <span className="ml-3">supply: {medals.length}</span>
            </>
          ) : (
            <>Set NEXT_PUBLIC_ZETTA_STREAM_MEDAL_ADDRESS in .env</>
          )}
        </div>
      </div>

      {medals.length === 0 ? (
        <div className="card p-8 text-center text-sm text-[rgb(var(--muted))]">
          No medals minted yet. Run a profitable rotation via{" "}
          <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-white/[0.05]">zetta-stream-action</code>
          .
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {medals.map((m) => (
            <div key={String(m.tokenId)} className="card overflow-hidden">
              {m.imageDataUri ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={m.imageDataUri}
                  alt={`Zetta-Stream Medal #${m.tokenId}`}
                  className="w-full aspect-square bg-black"
                />
              ) : (
                <div className="w-full aspect-square bg-black flex items-center justify-center text-[rgb(var(--muted))] text-xs">
                  no image
                </div>
              )}
              <div className="p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-[rgb(var(--muted))]">
                    #{String(m.tokenId)}
                  </span>
                  <span className="font-mono text-sm font-semibold text-[rgb(var(--accent))]">
                    +{m.netYieldBps} bps
                  </span>
                </div>
                <div className="font-mono text-[10px] text-[rgb(var(--muted))]">
                  rotation #{String(m.rotationId)} ·{" "}
                  {new Date(Number(m.mintedAt) * 1000).toLocaleDateString()}
                </div>
                <div className="font-mono text-[10px] text-[rgb(var(--muted))] truncate">
                  owner {m.owner.slice(0, 8)}…{m.owner.slice(-4)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
