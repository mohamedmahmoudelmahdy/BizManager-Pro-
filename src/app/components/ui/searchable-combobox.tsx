'use client';

import * as React from 'react';
import { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/app/components/ui/command';
import { cn } from '@/app/components/ui/utils';
import { matchesSearchText } from '@/app/utils/searchText';

export type SearchableComboboxOption = {
  value: string;
  label: string;
  searchText?: string;
};

type SearchableComboboxProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  textAlign?: 'left' | 'center';
  popoverModal?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  labelDir?: 'rtl' | 'ltr' | 'auto';
  /** When 'server', options are not filtered client-side; use onSearchChange instead. */
  filterMode?: 'client' | 'server';
  onSearchChange?: (query: string) => void;
  footerAction?: {
    label: string;
    onSelect: () => void;
  };
};

export function SearchableCombobox({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No results found',
  disabled = false,
  id,
  ariaLabel,
  textAlign = 'center',
  popoverModal = true,
  className,
  triggerClassName,
  contentClassName,
  labelDir = 'auto',
  filterMode = 'client',
  onSearchChange,
  footerAction,
}: SearchableComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedLabel = useMemo(
    () => options.find((option) => option.value === value)?.label ?? value,
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    if (filterMode === 'server' || !query.trim()) return options;
    return options.filter((option) =>
      matchesSearchText(option.searchText ?? option.label, query),
    );
  }, [options, query, filterMode]);

  const handleQueryChange = (next: string) => {
    setQuery(next);
    onSearchChange?.(next);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery('');
      onSearchChange?.('');
    }
  };

  const handleSelect = (nextValue: string) => {
    onValueChange(nextValue);
    handleOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={popoverModal}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            'flex w-full items-center justify-between gap-1 bg-transparent text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60',
            triggerClassName,
            className,
          )}
          onKeyDown={(event) => {
            if (disabled) return;
            if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              textAlign === 'left' ? 'text-left' : 'text-center',
              value ? 'text-gray-700' : 'text-gray-400',
            )}
            dir={labelDir}
          >
            {value ? selectedLabel : placeholder}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-gray-500 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        collisionPadding={8}
        className={cn(
          'w-[var(--radix-popover-trigger-width)] min-w-[240px] max-w-[min(420px,calc(100vw-1rem))] p-0',
          contentClassName,
        )}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={handleQueryChange}
          />
          <CommandList className="max-h-[min(280px,50vh)]">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => {
                // cmdk lowercases `value` and scores on it; prefer label+id so raw
                // UUIDs (hyphens) do not confuse selection inside nested Dialogs.
                const cmdkValue = `${option.label} ${option.value}`;
                return (
                  <CommandItem
                    key={option.value}
                    value={cmdkValue}
                    onSelect={() => handleSelect(option.value)}
                    className="items-start gap-2 py-2"
                  >
                    <Check
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        value === option.value ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="min-w-0 flex-1 whitespace-normal break-words text-sm" dir={labelDir}>
                      {option.label}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {footerAction ? (
            <>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  value="__footer_action__"
                  onSelect={() => {
                    handleOpenChange(false);
                    footerAction.onSelect();
                  }}
                  className="font-medium text-gray-800"
                >
                  ➕ {footerAction.label}
                </CommandItem>
              </CommandGroup>
            </>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
