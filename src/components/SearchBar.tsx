import React, { startTransition, useEffect, useRef, useState } from "react";

interface SearchBarProps {
  searchKeyword: string;
  onSearchKeywordChange: (keyword: string) => void;
  onSearchNext: (keyword?: string) => void;
  matchCount: number;
  currentMatchIndex: number;
}

const SearchBar: React.FC<SearchBarProps> = ({
  searchKeyword,
  onSearchKeywordChange,
  onSearchNext,
  matchCount,
  currentMatchIndex,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState(searchKeyword);
  const composing = useRef(false);
  const latestInput = useRef(searchKeyword);
  const pendingKeywords = useRef(new Set<string>());
  useEffect(() => {
    if (searchKeyword === latestInput.current) pendingKeywords.current.clear();
    else if (pendingKeywords.current.delete(searchKeyword)) return;
    latestInput.current = searchKeyword;
    setInputValue(searchKeyword);
  }, [searchKeyword]);
  const next = () => onSearchNext(latestInput.current);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      e.key === "Enter" &&
      !composing.current &&
      !e.nativeEvent.isComposing &&
      e.keyCode !== 229
    ) {
      e.preventDefault();
      next();
    }
  };

  return (
    <div className="flex items-center gap-2 px-2">
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => {
          const value = e.target.value;
          latestInput.current = value;
          pendingKeywords.current.add(value);
          setInputValue(value);
          startTransition(() => onSearchKeywordChange(value));
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={handleKeyDown}
        placeholder="検索..."
        className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition w-40"
      />
      <button
        onClick={next}
        disabled={!inputValue.trim()}
        className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:cursor-not-allowed whitespace-nowrap"
      >
        次を検索
      </button>
      {searchKeyword.trim() && matchCount > 0 && currentMatchIndex >= 0 && (
        <span className="text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
          {currentMatchIndex + 1} / {matchCount}
        </span>
      )}
      {searchKeyword.trim() && matchCount > 0 && currentMatchIndex < 0 && (
        <span className="text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
          {matchCount}件見つかりました
        </span>
      )}
      {searchKeyword.trim() && matchCount === 0 && (
        <span className="text-xs text-red-600 dark:text-red-400 whitespace-nowrap">
          該当なし
        </span>
      )}
    </div>
  );
};

export default SearchBar;
