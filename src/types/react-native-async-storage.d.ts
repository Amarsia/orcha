declare module "@react-native-async-storage/async-storage" {
  interface AsyncStorage {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    getAllKeys(): Promise<string[]>;
  }

  const storage: AsyncStorage;
  export default storage;
}
