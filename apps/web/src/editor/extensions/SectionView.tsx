import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { api } from "../../api.ts";
import { PostCard } from "../../components/Posts.tsx";
import { useEditorPage } from "../context.tsx";

/**
 * Where `/section` and `/dm-notes` render inline. The post itself lives in
 * the same place it always has (its own row, own visibility, same API) —
 * this just renders it at the position its `:::post {postId="..."} :::`
 * marker sits in the body, using the exact same card the old stacked list
 * used (`Posts.tsx`'s `PostCard`), so nothing about how a section looks or
 * saves changed, only where it renders.
 */
export function SectionView({ node }: NodeViewProps) {
  const { nodeId, allNodes, canEdit } = useEditorPage();
  const queryClient = useQueryClient();
  const postId = node.attrs.postId as string;

  const { data } = useQuery({
    queryKey: ["posts", nodeId],
    queryFn: () => api.posts(nodeId),
  });

  const post = data?.posts.find((p) => p.id === postId);

  return (
    <NodeViewWrapper data-post-id={postId} contentEditable={false}>
      {post === undefined ? (
        <p className="my-2 text-xs text-[#6b6e77]">Loading section…</p>
      ) : (
        <PostCard
          post={post}
          canEdit={canEdit}
          allNodes={allNodes}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: ["posts", nodeId] })}
        />
      )}
    </NodeViewWrapper>
  );
}
