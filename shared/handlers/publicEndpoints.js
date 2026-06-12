async function safeCall(label, action, failureMessage) {
  try {
    const body = await action();
    return { status: 200, body };
  } catch (err) {
    console.error(`[${label}] unexpected error:`, err.message ?? err);
    return { status: 500, body: { error: failureMessage } };
  }
}

export async function handleListPublicCalcs(_input, db) {
  return safeCall(
    'public-calcs',
    () => db.listPublicCalcs(),
    'Failed to fetch calculations'
  );
}

export async function handleGetFishData(_input, db) {
  return safeCall(
    'fish-data',
    () => db.getFishData(),
    'Failed to fetch fish data'
  );
}

export async function handleListContributors(_input, db) {
  return safeCall(
    'contributors',
    () => db.listContributors(),
    'Failed to fetch contributors'
  );
}

export async function handleGetContributorProfile(input, db) {
  const { userId } = input;
  if (!userId) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  try {
    const profile = await db.getContributorProfile(userId);
    if (!profile) {
      return { status: 404, body: { error: 'Profile not found' } };
    }
    return { status: 200, body: profile };
  } catch (err) {
    console.error('[contributor-profile] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to fetch profile' } };
  }
}

export async function handleSaveContributorProfile(input, db) {
  const { userId, display_name, organization, bio, show_on_page } = input;
  if (!userId) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  const showOnPage = show_on_page === true || show_on_page === 'true' || show_on_page === 1;

  try {
    const result = await db.saveContributorProfile(userId, {
      display_name,
      organization,
      bio,
      show_on_page: showOnPage,
    });

    return {
      status: result.created ? 201 : 200,
      body: result.created
        ? { id: result.id, message: 'Profile created successfully' }
        : { message: 'Profile updated successfully' },
    };
  } catch (err) {
    console.error('[save-contributor-profile] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to save profile' } };
  }
}
