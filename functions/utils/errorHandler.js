export default function errorHandler(error) {
  console.error(error);
  return { statusCode: 500, body: 'Server error' };
}
