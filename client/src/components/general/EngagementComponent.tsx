import { PiArrowFatUpFill, PiArrowFatDownFill } from "react-icons/pi";
import axios, { AxiosError } from "axios";
import { env } from "@/conf/env";
import { useErrorHandler } from "@/hooks/useErrorHandler";
import { useEffect, useState } from "react";
import { FaEye } from 'react-icons/fa';
import ShareButton from "../actions/ShareButton";
import CommentButton from "../actions/CommentButton";
import { toast } from "sonner";

type EngagementType = 'upvotes' | 'downvotes' | 'comments' | 'views' | "share";

type Count = {
  upvotes?: number;
  downvotes?: number;
  comments?: number;
  views?: number;
}

type EngagementComponentProps = {
  initialCounts: Count;
  _id: string
  targetType: 'post' | 'comment'
  initialUpvoted?: boolean;
  initialDownvoted?: boolean;
  userVote: "upvote" | "downvote" | null
  show?: EngagementType[];
};

const EngagementComponent = ({
  initialCounts = { upvotes: 0, downvotes: 0, comments: 0, views: 0 },
  _id,
  userVote,
  targetType = 'post',
  show = ['upvotes', 'downvotes', 'comments', 'views'],
}: EngagementComponentProps) => {
  const [isVoting, setIsVoting] = useState(false);
  const [optimisticCounts, setOptimisticCounts] = useState(initialCounts);

  const [upvoted, setUpvoted] = useState(userVote === 'upvote');
  const [downvoted, setDownvoted] = useState(userVote === 'downvote');

  const { handleError } = useErrorHandler()

  useEffect(() => {
    setUpvoted(userVote === 'upvote');
    setDownvoted(userVote === 'downvote');
  }, [userVote]);


  const getUpdatedCounts = (prevCounts: Count, upvoted: boolean, downvoted: boolean, type: 'upvote' | 'downvote') => {
    const newCounts = { ...prevCounts };
    if (type === 'upvote') {
      if (downvoted) newCounts.downvotes = (newCounts.downvotes ?? 0) - 1;
      newCounts.upvotes = (newCounts.upvotes ?? 0) + (upvoted ? -1 : 1);
    } else {
      if (upvoted) newCounts.upvotes = (newCounts.upvotes ?? 0) - 1;
      newCounts.downvotes = (newCounts.downvotes ?? 0) + (downvoted ? -1 : 1);
    }
    return newCounts;
  };

  const handleVote = async (type: 'upvote' | 'downvote') => {
    if (isVoting) return;

    const previousCounts = optimisticCounts;
    const prevUpvoted = upvoted;
    const prevDownvoted = downvoted;

    let action: 'post' | 'delete' | 'patch' = 'post';

    if (type === 'upvote') {
      if (upvoted) action = 'delete'
      else if (downvoted) action = 'patch';
      else action = 'post';
    } else {
      if (downvoted) action = 'delete';
      else if (upvoted) action = 'patch';
      else action = 'post';
    }

    setOptimisticCounts(prev => getUpdatedCounts(prev, upvoted, downvoted, type));

    if (type === 'upvote') {
      if (downvoted) setDownvoted(false);
      setUpvoted(!upvoted);
    } else {
      if (upvoted) setUpvoted(false);
      setDownvoted(!downvoted);
    }

    setIsVoting(true);
    try {
      if (action === 'post') {
        await axios.post(`${env.serverApiEndpoint}/votes`, {
          voteType: type,
          targetId: _id,
          targetType
        }, { withCredentials: true });
      } else if (action === 'delete') {
        await axios.delete(`${env.serverApiEndpoint}/votes`, {
          data: { targetId: _id, targetType },
          withCredentials: true,
        });
      } else if (action === 'patch') {
        await axios.patch(`${env.serverApiEndpoint}/votes`, {
          voteType: type,
          targetId: _id,
          targetType,
        }, {
          withCredentials: true,
          headers: {
            'Content-Type': 'application/json',
          }
        });
      }
    } catch (error) {
      await handleError(
        error as AxiosError | Error,
        "Failed to update vote",
        undefined,
        () => handleVote(type),
        `Failed to ${type}`,
        () => {
          setOptimisticCounts(previousCounts);
          setUpvoted(prevUpvoted);
          setDownvoted(prevDownvoted);
        }
      );
    } finally {
      setIsVoting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-5">
      {show.includes('upvotes') && (
        <div className="flex items-center gap-1">
          <button disabled={isVoting} onClick={(e) => { e.stopPropagation(); handleVote("upvote") }} aria-label={upvoted ? 'Remove upvote' : 'Upvote'} className="p-0.5 focus:outline-none">
            <PiArrowFatUpFill className={`${upvoted ? "text-blue-500" : "text-gray-400"} hover:scale-110 hover:text-blue-400 transition-all text-xl`} />
          </button>
          <span className="text-sm text-gray-600 dark:text-gray-400 w-3 cursor-pointer select-none">{optimisticCounts.upvotes}</span>
        </div>
      )}

      {show.includes('downvotes') && (
        <div className="flex items-center gap-1">
          <button disabled={isVoting} onClick={(e) => { e.stopPropagation(); handleVote("downvote") }} aria-label={downvoted ? 'Remove downvote' : 'Downvote'} className="p-0.5 focus:outline-none">
            <PiArrowFatDownFill className={`${downvoted ? "text-red-500" : "text-gray-400"} hover:scale-110 hover:text-red-400 transition-all text-xl`} />
          </button>
          <span className="text-sm text-gray-600 dark:text-gray-400 w-3 cursor-pointer select-none">{optimisticCounts.downvotes}</span>
        </div>
      )}

      {show.includes('comments') && (
        <div className="flex items-center gap-1">
          <CommentButton parentCommentId={targetType === "comment" ? _id : null} />
          <span className="text-sm text-gray-600 dark:text-gray-400 w-3">{optimisticCounts.comments}</span>
        </div>
      )}

      {show.includes('views') && (
        <div className="flex items-center gap-1">
          <button disabled={isVoting} onClick={(e) => { e.stopPropagation(); toast.info("Analytics feature is under development") }} aria-label={downvoted ? 'Remove downvote' : 'Downvote'} className="p-0.5 focus:outline-none">
          <FaEye className="text-gray-400 text-xl m-0.5" />
          </button>
          <span className="text-sm text-gray-600 dark:text-gray-400 w-3">{optimisticCounts.views}</span>
        </div>
      )}

      {show.includes('share') && (
        <ShareButton id={_id} />
      )}
    </div>
  );
};

export default EngagementComponent;