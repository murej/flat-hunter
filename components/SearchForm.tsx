"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SavedSearch } from "@/lib/types";

type SearchFormProps = {
  onSearch: (url: string) => void;
  onSaveSearch?: (name: string, url: string) => void;
  loading?: boolean;
};

export function SearchForm({
  onSearch,
  onSaveSearch,
  loading = false,
}: SearchFormProps) {
  const [url, setUrl] = useState("");
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [selectedSearchId, setSelectedSearchId] = useState<string>("");
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);

  useEffect(() => {
    fetch("/api/saved-searches")
      .then((r) => r.json())
      .then((list: SavedSearch[]) => setSavedSearches(list))
      .catch(() => {});
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const toUse = selectedSearchId
      ? savedSearches.find((s) => String(s.id) === selectedSearchId)?.url
      : url.trim();
    if (toUse) onSearch(toUse);
  };

  const handleSaveSearch = () => {
    const u = url.trim() || savedSearches.find((s) => String(s.id) === selectedSearchId)?.url;
    if (onSaveSearch && saveName.trim() && u) {
      onSaveSearch(saveName.trim(), u);
      setSaveName("");
      setShowSave(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="url">Rightmove search URL</Label>
        <Input
          id="url"
          placeholder="Paste Rightmove search URL (e.g. from rightmove.co.uk)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
        />
      </div>
      {savedSearches.length > 0 && (
        <div className="space-y-2">
          <Label>Or pick a saved search</Label>
          <Select
            value={selectedSearchId}
            onValueChange={(v) => {
              setSelectedSearchId(v);
              const s = savedSearches.find((x) => String(x.id) === v);
              if (s) setUrl(s.url);
            }}
            disabled={loading}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select saved search" />
            </SelectTrigger>
            <SelectContent>
              {savedSearches.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={loading || (!url.trim() && !selectedSearchId)}>
          {loading ? "Searching…" : "Search"}
        </Button>
        {onSaveSearch && (
          <>
            {!showSave ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowSave(true)}
                disabled={loading}
              >
                Save this search
              </Button>
            ) : (
              <div className="flex gap-2 items-center">
                <Input
                  placeholder="Search name"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  className="w-40"
                />
                <Button type="button" onClick={handleSaveSearch} disabled={!saveName.trim()}>
                  Save
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowSave(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </form>
  );
}
