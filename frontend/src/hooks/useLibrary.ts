/**
 * @file useLibrary.ts
 * @description TanStack Query hooks for the Library catalog and book circulation.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { libraryService } from '../services';
import type {
  BookInput,
  BookUpdateInput,
  IssueBookInput,
  ListBooksParams,
  ListIssuesParams,
} from '../types';

export const LIBRARY_KEYS = {
  all: ['library'] as const,
  books: (params: ListBooksParams) => [...LIBRARY_KEYS.all, 'books', params] as const,
  issues: (params: ListIssuesParams) => [...LIBRARY_KEYS.all, 'issues', params] as const,
  summary: () => [...LIBRARY_KEYS.all, 'summary'] as const,
};

export const useLibraryBooks = (params: ListBooksParams) =>
  useQuery({
    queryKey: LIBRARY_KEYS.books(params),
    queryFn: () => libraryService.getBooks(params),
    placeholderData: keepPreviousData, // keep the table steady while searching/paging
    staleTime: 1000 * 30,
  });

export const useLibraryIssues = (params: ListIssuesParams, enabled = true) =>
  useQuery({
    queryKey: LIBRARY_KEYS.issues(params),
    queryFn: () => libraryService.getIssues(params),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 30,
  });

export const useLibrarySummary = () =>
  useQuery({
    queryKey: LIBRARY_KEYS.summary(),
    queryFn: libraryService.getSummary,
    staleTime: 1000 * 30,
  });

/** Stock, register and counters all move together, so every mutation refreshes the lot. */
const useLibraryMutation = <TVariables, TResult>(mutationFn: (vars: TVariables) => Promise<TResult>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LIBRARY_KEYS.all }),
  });
};

export const useCreateBook = () =>
  useLibraryMutation((data: BookInput) => libraryService.createBook(data));

export const useUpdateBook = () =>
  useLibraryMutation(({ id, data }: { id: string; data: BookUpdateInput }) =>
    libraryService.updateBook(id, data)
  );

export const useDeleteBook = () =>
  useLibraryMutation((id: string) => libraryService.deleteBook(id));

export const useIssueBook = () =>
  useLibraryMutation((data: IssueBookInput) => libraryService.issueBook(data));

export const useReturnBook = () =>
  useLibraryMutation((issueId: string) => libraryService.returnBook(issueId));
