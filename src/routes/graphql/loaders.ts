import DataLoader from 'dataloader';
import type { PrismaClient, MemberType, Profile, Post, User } from '@prisma/client';
import { parseResolveInfo, type ResolveTree } from 'graphql-parse-resolve-info';
import type { GraphQLResolveInfo } from 'graphql';

export interface LoadersContext {
  memberTypeLoader: DataLoader<string, MemberType | null>;
  profileLoader: DataLoader<string, Profile | null>;
  postsLoader: DataLoader<string, Post[]>;
  userSubscribedToLoader: DataLoader<string, User[]>;
  subscribedToUserLoader: DataLoader<string, User[]>;
  allUsersLoader: DataLoader<GraphQLResolveInfo, User[]>;
}

export function createLoaders(prisma: PrismaClient): LoadersContext {
  const memberTypeLoader = new DataLoader(async (ids: readonly string[]) => {
    const memberTypes = await prisma.memberType.findMany({
      where: {
        id: { in: [...ids] },
      },
    });
    const memberTypeMap = new Map(memberTypes.map((mt) => [mt.id, mt]));
    return ids.map((id) => memberTypeMap.get(id) || null);
  });

  const profileLoader = new DataLoader(async (userIds: readonly string[]) => {
    const profiles = await prisma.profile.findMany({
      where: {
        userId: { in: [...userIds] },
      },
    });
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));
    return userIds.map((userId) => profileMap.get(userId) || null);
  });

  const postsLoader = new DataLoader(async (authorIds: readonly string[]) => {
    const posts = await prisma.post.findMany({
      where: {
        authorId: { in: [...authorIds] },
      },
    });
    const postsMap = new Map<string, Post[]>();
    authorIds.forEach((id) => postsMap.set(id, []));
    posts.forEach((post) => {
      const list = postsMap.get(post.authorId) || [];
      list.push(post);
      postsMap.set(post.authorId, list);
    });
    return authorIds.map((id) => postsMap.get(id) || []);
  });

  const userSubscribedToLoader = new DataLoader(async (subscriberIds: readonly string[]) => {
    const subscriptions = await prisma.subscribersOnAuthors.findMany({
      where: {
        subscriberId: { in: [...subscriberIds] },
      },
    });

    const authorIds = subscriptions.map((s) => s.authorId);
    const users = await prisma.user.findMany({
      where: {
        id: { in: authorIds },
      },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));
    const subsMap = new Map<string, User[]>();
    subscriberIds.forEach((id) => subsMap.set(id, []));

    subscriptions.forEach((sub) => {
      const user = userMap.get(sub.authorId);
      if (user) {
        const list = subsMap.get(sub.subscriberId) || [];
        list.push(user);
        subsMap.set(sub.subscriberId, list);
      }
    });

    return subscriberIds.map((id) => subsMap.get(id) || []);
  });

  const subscribedToUserLoader = new DataLoader(async (authorIds: readonly string[]) => {
    const subscriptions = await prisma.subscribersOnAuthors.findMany({
      where: {
        authorId: { in: [...authorIds] },
      },
    });

    const subscriberIds = subscriptions.map((s) => s.subscriberId);
    const users = await prisma.user.findMany({
      where: {
        id: { in: subscriberIds },
      },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));
    const subsMap = new Map<string, User[]>();
    authorIds.forEach((id) => subsMap.set(id, []));

    subscriptions.forEach((sub) => {
      const user = userMap.get(sub.subscriberId);
      if (user) {
        const list = subsMap.get(sub.authorId) || [];
        list.push(user);
        subsMap.set(sub.authorId, list);
      }
    });

    return authorIds.map((id) => subsMap.get(id) || []);
  });

  const allUsersLoader = new DataLoader(
    async (infos: readonly GraphQLResolveInfo[]) => {
      const info = infos[0];
      const parsedInfo = parseResolveInfo(info) as ResolveTree;

      const fields = parsedInfo?.fieldsByTypeName?.User || {};
      const needsUserSubscribedTo = 'userSubscribedTo' in fields;
      const needsSubscribedToUser = 'subscribedToUser' in fields;

      interface UserWithSubs extends User {
        userSubscribedTo?: Array<{ authorId: string; subscriberId: string }>;
        subscribedToUser?: Array<{ authorId: string; subscriberId: string }>;
      }

      interface UserInclude {
        userSubscribedTo?: boolean;
        subscribedToUser?: boolean;
      }

      const include: UserInclude = {};
      if (needsUserSubscribedTo) {
        include.userSubscribedTo = true;
      }
      if (needsSubscribedToUser) {
        include.subscribedToUser = true;
      }

      const users = await prisma.user.findMany({
        include: Object.keys(include).length > 0 ? include : undefined,
      }) as UserWithSubs[];

      // Prime the individual loaders with the included relation data
      if (needsUserSubscribedTo || needsSubscribedToUser) {
        // Create a map of all users by ID for efficient lookup
        const userMap = new Map(users.map((u) => [u.id, u]));

        // Prime the loaders using users from the same query result
        users.forEach((user) => {
          if (needsUserSubscribedTo && user.userSubscribedTo) {
            const subscribedUsers = user.userSubscribedTo
              .map((sub) => userMap.get(sub.authorId))
              .filter((u): u is User => u !== undefined);
            userSubscribedToLoader.prime(user.id, subscribedUsers);
          }

          if (needsSubscribedToUser && user.subscribedToUser) {
            const subscriberUsers = user.subscribedToUser
              .map((sub) => userMap.get(sub.subscriberId))
              .filter((u): u is User => u !== undefined);
            subscribedToUserLoader.prime(user.id, subscriberUsers);
          }
        });
      }

      return infos.map(() => users);
    },
    {
      cacheKeyFn: (info: GraphQLResolveInfo) => {
        const parsedInfo = parseResolveInfo(info) as ResolveTree;
        const fields = parsedInfo?.fieldsByTypeName?.User || {};
        const needsUserSubscribedTo = 'userSubscribedTo' in fields;
        const needsSubscribedToUser = 'subscribedToUser' in fields;
        return `users:${needsUserSubscribedTo}:${needsSubscribedToUser}`;
      },
    },
  );

  return {
    memberTypeLoader,
    profileLoader,
    postsLoader,
    userSubscribedToLoader,
    subscribedToUserLoader,
    allUsersLoader,
  };
}

